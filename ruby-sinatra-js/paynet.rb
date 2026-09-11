# frozen_string_literal: true

# The three gateway calls the Hosted Fields flow needs.
# https://doc.payneteasy.com/integration/api_use_cases/hosted_fields.html

require 'json'
require 'logger'
require 'net/http'
require 'time'
require 'uri'

require_relative 'oauth'
require_relative 'settings'

module Paynet
  # The Go example's http.Client has the same 30 seconds, and Next passes the same AbortSignal:
  # without one a wedged gateway holds the request, and the payer's page, indefinitely. Net::HTTP
  # needs both halves named, or it waits forever on the half left out.
  OPEN_TIMEOUT = 30
  READ_TIMEOUT = 30

  LOG = Logger.new($stderr)
  LOG.formatter = proc { |_severity, time, _program, message| "#{time.iso8601} #{message}\n" }

  # Step 1. A single-use ticket the browser exchanges for a hosted fields token. Valid for 15
  # minutes and safe to put on the page.
  def self.ephemeral_ticket
    reply = post_json("#{Settings::API_URL}/api/v4/tokenize/create-ephemeral-ticket/#{Settings::ENDPOINT_ID}")

    ticket = reply['ephemeralTicket'].to_s.strip
    return ticket unless ticket.empty?

    # A rejected request comes back as 4xx with a JSON body carrying the reason. Only that one
    # field is quoted: this reason travels on into config.js, where the browser can read it, and
    # the rest of the reply is the gateway's business and not the payer's.
    message = reply['error-message'].to_s
    raise(message.empty? ? 'no ephemeralTicket in the response' : message)
  end

  # Step 3. Charges the card behind the hosted fields token. The token replaces
  # credit_card_number, expire_month, expire_year and cvv2 — sending those is an error.
  #
  # `payer` holds what our own inputs next to the card iframes collected, as
  # firstName / lastName / email / cardPrintedName.
  def self.sale(hosted_fields_token:, client_order_id:, ip_address:, browser:, payer:)
    # 3DS 2.0 browser data, required by /api/v4/sale. It comes from the page, so it goes first and
    # every server-owned field below overwrites it — app.rb has already filtered it to the
    # documented keys, and this ordering is what keeps that a belt and not a single thread.
    params = browser.merge(
      'client_orderid' => client_order_id,
      'order_desc' => 'Hosted Fields example order',
      'amount' => Settings::ORDER_AMOUNT,
      'currency' => Settings::ORDER_CURRENCY,
      'hosted_fields_token' => hosted_fields_token,
      # Composed by the page from first and last name: the hosted fields token does not carry the
      # holder, and with the token the platform leaves it empty unless it is sent here — which
      # some acquirers do not survive.
      'card_printed_name' => payer['cardPrintedName'],
      'first_name' => payer['firstName'],
      'last_name' => payer['lastName'],
      'address1' => '100 Main st',
      'city' => 'Seattle',
      'zip_code' => '98102',
      'country' => 'US',
      'state' => 'WA',
      'phone' => '+12063582043',
      'email' => payer['email'],
      'ipaddress' => ip_address,
      'redirect_url' => Settings::REDIRECT_URL
    )

    post_json("#{Settings::API_URL}/api/v4/sale/#{Settings::ENDPOINT_ID}", params)
  end

  # Step 4. Polled until the order reaches a final status.
  def self.status(order_id:, client_order_id:)
    post_json(
      "#{Settings::API_URL}/api/v4/status/#{Settings::ENDPOINT_ID}",
      'login' => Settings::MERCHANT_LOGIN,
      'client_orderid' => client_order_id,
      'orderid' => order_id
    )
  end

  # Sends a signed command and decodes the reply.
  #
  # A rejected request — a validation error or a decline — comes back as 4xx with a JSON body, so
  # the body is decoded whatever the status: it carries the error-message for the page. Unlike
  # Python's urlopen, Net::HTTP does not raise on a 4xx, so there is nothing to catch here. Only a
  # reply that is not a JSON object at all counts as a failure of the call itself.
  def self.post_json(url, params = {})
    body, status = post(url, params)

    decoded = begin
      JSON.parse(body)
    rescue JSON::ParserError
      nil
    end

    # The body is not quoted: it reaches the page as {error}. The log line has the detail.
    raise "gateway request failed with #{status}" unless decoded.is_a?(Hash)

    decoded
  end

  # The transport. Always POST, always form-encoded, always signed.
  def self.post(url, params = {})
    uri = URI.parse(url)

    request = Net::HTTP::Post.new(uri)
    request['Content-Type'] = 'application/x-www-form-urlencoded'
    # Ask for JSON instead of the default x-www-form-urlencoded reply, which arrives as key=value
    # pairs separated by newlines. https://doc.payneteasy.com/integration/openapi.html
    request['Accept'] = 'application/vnd.pay+json'
    request['Authorization'] = OAuth.auth_header('POST', url, params)
    request.body = URI.encode_www_form(params)

    reply = Net::HTTP.start(
      uri.hostname, uri.port,
      use_ssl: uri.scheme == 'https', open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT
    ) { |http| http.request(request) }

    LOG.info("[paynet] POST #{url} -> #{reply.code}#{log_reason(reply.body)}")
    [reply.body.to_s, reply.code.to_i]
  end

  # What goes in the log beside the status code.
  #
  # Not the body: a status reply carries the card's last four digits and the holder's name, and
  # the ticket reply carries the ticket. The gateway puts everything a log needs to be useful into
  # these two fields anyway.
  def self.log_reason(body)
    decoded = begin
      JSON.parse(body.to_s)
    rescue JSON::ParserError
      nil
    end
    return ' (reply is not JSON)' unless decoded.is_a?(Hash)

    reason = ''
    order_id = log_field(decoded, 'paynet-order-id')
    reason += " order #{order_id}" unless order_id.empty?
    message = log_field(decoded, 'error-message')
    reason += " #{message}" unless message.empty?

    reason
  end

  # Renders one value of a decoded reply as a single line, whatever JSON type it arrived as.
  #
  # The gateway answers paynet-order-id as a number in a sale reply and as a string everywhere
  # else; JSON.parse keeps an integer exact, so a long one does not print as 1.2345678901e+10.
  def self.log_field(decoded, name)
    value = decoded[name]
    return '' if value.nil? || value.is_a?(Hash) || value.is_a?(Array)

    value.to_s.split.join(' ')
  end
end
