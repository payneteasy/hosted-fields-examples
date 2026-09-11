# frozen_string_literal: true

# The 3DS return is only as good as this checksum: it is what separates a payer coming back from
# the bank from somebody typing an order id into the address bar. The vectors below were computed
# outside this code, so a change in how the string is assembled shows up here as a failure rather
# than agreeing with itself. Every other example checks the very same ones.

require 'minitest/autorun'

require_relative 'settings_stub'

# Before requiring the module under test: control.rb reads MERCHANT_CONTROL from settings.rb
SettingsStub.apply

require_relative '../control'

class ControlTest < Minitest::Test
  # sha1('approved' + '1234567' + 'hf-abc' + 'test-merchant-control')
  CONTROL = '652ace404c4dfe8bba069ecee594ec23a89340e1'
  CALLBACK = {
    'status' => 'approved',
    'orderid' => '1234567',
    'merchant_order' => 'hf-abc',
    'control' => CONTROL
  }.freeze

  def test_accepts_what_the_gateway_signed
    assert Control.valid_callback?(CALLBACK)
  end

  def test_every_signed_field_is_part_of_the_checksum
    %w[status orderid merchant_order].each do |field|
      refute Control.valid_callback?(CALLBACK.merge(field => 'edited')), "#{field} is not signed"
    end
  end

  def test_rejects_a_wrong_control_of_the_right_length
    wrong = CONTROL[0..-2] + (CONTROL.end_with?('1') ? '2' : '1')
    assert_equal CONTROL.length, wrong.length
    refute Control.valid_callback?(CALLBACK.merge('control' => wrong))
  end

  def test_rejects_a_control_of_the_wrong_length_without_raising
    # secure_compare is the reason this is a 403 and not a 500
    refute Control.valid_callback?(CALLBACK.merge('control' => 'short'))
    refute Control.valid_callback?(CALLBACK.merge('control' => "#{CONTROL}extra"))
  end

  def test_rejects_a_request_with_nothing_in_it
    # sha1('' + '' + '' + 'test-merchant-control') — an empty callback still has a checksum, and
    # it is not the empty string, so a bare /result must not pass.
    refute Control.valid_callback?({})
    assert Control.valid_callback?({ 'control' => '1a66987ac24e927ff2979f83a41cb818936a9e62' })
  end

  def test_the_signed_fields_travel_in_the_order_the_page_wants
    assert_equal %w[status orderid merchant_order control], Control::SIGNED_CALLBACK_FIELDS
  end
end
