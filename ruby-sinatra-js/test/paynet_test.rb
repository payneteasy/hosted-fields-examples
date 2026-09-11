# frozen_string_literal: true

# The gateway is not consistent about the JSON type of paynet-order-id — a sale reply answers with
# a number, other calls with a string — so the log line has to survive both. The Go example used
# to decode into a typed struct, which reported a perfectly good sale reply as
# "reply is not JSON".

require 'minitest/autorun'

require_relative 'settings_stub'

# Before requiring the module under test: paynet.rb requires oauth.rb, which requires settings.rb
SettingsStub.apply

require_relative '../paynet'

class PaynetLogReasonTest < Minitest::Test
  CASES = {
    'sale reply, order id as a number' => [
      '{"type":"async-form-response","paynet-order-id":12345,"merchant-order-id":"hf-abc"}',
      ' order 12345'
    ],
    'order id as a string' => [
      '{"paynet-order-id":"12345","merchant-order-id":"hf-abc"}',
      ' order 12345'
    ],
    'a long order id keeps its digits, rather than turning into 1.2345678901e+10' => [
      '{"paynet-order-id":12345678901}',
      ' order 12345678901'
    ],
    'a decline carries the reason as well' => [
      '{"paynet-order-id":12345,"error-message":"Declined by the issuer","error-code":3}',
      ' order 12345 Declined by the issuer'
    ],
    'a message spread over lines is flattened' => [
      '{"error-message":"Declined\n  by the issuer"}',
      ' Declined by the issuer'
    ],
    'nothing worth logging' => [
      '{"type":"async-form-response"}',
      ''
    ],
    'a reply that really is not JSON says so' => [
      "type=async-form-response\npaynet-order-id=12345",
      ' (reply is not JSON)'
    ]
  }.freeze

  def test_survives_every_type_the_gateway_answers_with
    CASES.each do |name, (body, want)|
      assert_equal want, Paynet.log_reason(body), name
    end
  end

  def test_keeps_the_body_out_of_the_log
    # A status reply carries the card and the holder, and the ticket reply carries the ticket.
    body = '{"paynet-order-id":12345,"card-printed-name":"JOHN SMITH","last-four-digits":"4448"' \
           ',"ephemeralTicket":"secret-ticket"}'
    line = Paynet.log_reason(body)

    ['JOHN SMITH', '4448', 'secret-ticket'].each do |secret|
      refute_includes line, secret, "log_reason leaked #{secret}"
    end
  end
end
