# frozen_string_literal: true

# Routes and handlers. Everything is mounted under BASE_PATH, so several examples fit behind one
# nginx.
#
# The two pages are static files: the only thing this server generates is window.CONFIG, and it
# hands that over as a script of its own. That is what lets views/ be identical whatever language
# the example is written in.
#
# Sinatra has no route prefix of its own, so BASE_PATH is interpolated into each pattern. Putting
# a `map` in config.ru would prefix them too, but then `ruby app.rb` and `puma config.ru` would
# not agree on the URLs.

require 'json'
require 'securerandom'
require 'sinatra/base'

require_relative 'control'
require_relative 'paynet'
require_relative 'settings'

class HostedFieldsExample < Sinatra::Base
  BASE = Settings::BASE_PATH

  # What a payment page ought to send. The policy is worth reading as part of the example: the
  # card fields are iframes from the gateway, so the SDK host has to be named in frame-src as well
  # as in script-src, and everything else is denied by default.
  #
  # No 'unsafe-inline' anywhere, which is why the result page's script lives in public/result.js
  # rather than in the markup: nothing in views/ is templated, so there is nowhere to put a nonce.
  CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "script-src 'self' #{Settings::SDK_ORIGIN}",
    "style-src 'self'",
    # The three card inputs are cross-origin iframes served by the gateway
    "frame-src #{Settings::SDK_ORIGIN}",
    "connect-src 'self' #{Settings::SDK_ORIGIN}",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')

  # The stylesheet and the client scripts, with the type each is served as. An allowlist and not
  # Sinatra's public_folder, which serves at the root rather than under the prefix — and an
  # allowlist is also what keeps views/, .env and the sources unreachable.
  STATIC_FILES = {
    'styles.css' => 'text/css; charset=utf-8',
    'status.js' => 'text/javascript; charset=utf-8',
    'checkout.js' => 'text/javascript; charset=utf-8',
    'result.js' => 'text/javascript; charset=utf-8'
  }.freeze

  # The 3DS 2.0 values the page is allowed to supply. Everything else the Sale needs — amount,
  # currency, redirect_url, hosted_fields_token, client_orderid — belongs to the server, so the
  # request body is filtered here rather than merged: a body naming "amount" would otherwise have
  # chosen what the payer is charged.
  BROWSER_FIELDS = %w[
    customer_browser_info
    customer_browser_javascript_enabled
    customer_browser_java_enabled
    customer_browser_accept_language
    customer_browser_color_depth
    customer_browser_screen_width
    customer_browser_screen_height
    customer_browser_time_zone
  ].freeze

  configure do
    # Everything lives under the prefix and goes through the allowlist below, so Sinatra's own
    # static handler — which would serve public/ at the root as well — is off.
    set :static, false
    set :bind, Settings::LISTEN_ADDR
    set :port, Settings::PORT
    # Two of rack-protection's defaults have to go, and both would be quiet about it:
    #
    # http_origin answers a cross-origin POST with a 403, and the gateway POSTs the 3DS return
    # from its own origin — the callback is authenticated by `control`, a shared secret, rather
    # than by where it came from;
    #
    # frame_options sends X-Frame-Options: SAMEORIGIN, which contradicts the
    # `frame-ancestors 'none'` this app's own policy sends and which no other example here sends.
    # The CSP directive is the stronger of the two and is what the repository standardises on.
    set :protection, except: %i[http_origin frame_options]
    # A relative Location, like every other example emits. Sinatra's default builds an absolute
    # one from the request's Host and scheme, which behind a TLS-terminating proxy would redirect
    # the payer from https:// to http:// on the way back from a 3DS challenge.
    set :absolute_redirects, false
    disable :show_exceptions
    disable :dump_errors
  end

  get "#{BASE}/" do
    send_view('checkout.html')
  end

  # Step 1. A fresh single-use ticket for every page load, handed to the page as a script.
  get "#{BASE}/config.js" do
    config = {
      'basePath' => Settings::BASE_PATH,
      'sdkUrl' => Settings::SDK_URL,
      'endpointId' => Settings::ENDPOINT_ID,
      # The page shows what the server will actually charge
      'amount' => Settings::ORDER_AMOUNT,
      'currency' => Settings::ORDER_CURRENCY
    }

    begin
      config['ephemeralTicket'] = Paynet.ephemeral_ticket
    rescue StandardError => e
      # This has to stay valid JavaScript whatever happened upstream, or the page cannot even tell
      # the payer that it did. checkout.js reads the absent ticket as terminal.
      Paynet::LOG.error("[error] #{e.message}")
      config['error'] = e.message
    end

    send_config_js(config)
  end

  # The 3DS return page needs no ticket: there is no card on it to tokenize.
  get "#{BASE}/result-config.js" do
    send_config_js(
      'basePath' => Settings::BASE_PATH,
      'amount' => Settings::ORDER_AMOUNT,
      'currency' => Settings::ORDER_CURRENCY
    )
  end

  # Step 3. The browser has exchanged the card for a token; start the payment.
  post "#{BASE}/pay" do
    payment = begin
      JSON.parse(request.body.read.to_s)
    rescue JSON::ParserError
      nil
    end
    halt_json(400, 'error' => 'malformed request body') unless payment.is_a?(Hash)

    token = payment['hostedFieldsToken']
    halt_json(400, 'error' => 'hostedFieldsToken is required') unless token.is_a?(String) && !token.empty?

    client_order_id = new_client_order_id
    begin
      sale = Paynet.sale(
        hosted_fields_token: token,
        client_order_id: client_order_id,
        ip_address: client_ip,
        browser: pick_browser(payment['browser'].is_a?(Hash) ? payment['browser'] : {}),
        payer: payer_details(payment['customer'].is_a?(Hash) ? payment['customer'] : {})
      )
    rescue StandardError => e
      fail_json(e)
    end

    # clientOrderId last: it is the server's, and a gateway field of the same name must not win
    json_body(sale.merge('clientOrderId' => client_order_id))
  end

  # Step 4. The page polls this until the order reaches a final status.
  get "#{BASE}/status" do
    order_id = params['orderId'].to_s
    client_order_id = params['clientOrderId'].to_s
    if order_id.empty? || client_order_id.empty?
      halt_json(400, 'error' => 'orderId and clientOrderId are required')
    end

    begin
      status = Paynet.status(order_id: order_id, client_order_id: client_order_id)
    rescue StandardError => e
      fail_json(e)
    end

    headers 'Cache-Control' => 'no-store'
    json_body(status)
  end

  # Step 5. Where the gateway returns the payer after a 3DS challenge, with a POST.
  #
  # It is not a page, because a page cannot be delivered by POST and still be reloadable: the
  # signature is checked here and the payer is sent on to /result with the same signed parameters
  # in the query. The browser carries them, but it cannot forge them — it does not know
  # MERCHANT_CONTROL — and /result checks them again before it serves anything.
  post "#{BASE}/result/callback" do
    unless Control.valid_callback?(params)
      Paynet::LOG.error("[error] callback signature mismatch for order #{params['orderid']}")
      halt 403, { 'Content-Type' => 'text/plain; charset=utf-8' }, "invalid callback signature\n"
    end

    # 303, so the browser follows with a GET whatever it arrived with
    redirect result_url(params), 303
  end

  # A GET here is nobody arriving from a payment; send them to the empty page.
  get "#{BASE}/result/callback" do
    redirect result_url({}), 303
  end

  # The 3DS return page. The callback carries the outcome too, but the documentation says not to
  # treat it as the status — the page looks the order up over the API instead.
  get "#{BASE}/result" do
    # The query is only there when the payer came through the callback. Rechecking it here is what
    # stops a hand-edited URL: without it the page would happily poll somebody else's order. No
    # query at all is fine — the page then says there is nothing to show.
    if !params['orderid'].to_s.empty? && !Control.valid_callback?(params)
      Paynet::LOG.error("[error] result signature mismatch for order #{params['orderid']}")
      halt 403, { 'Content-Type' => 'text/plain; charset=utf-8' }, "invalid result signature\n"
    end

    send_view('result.html')
  end

  # The stylesheet and the client scripts.
  get "#{BASE}/:name" do
    name = params['name'].to_s
    pass unless STATIC_FILES.key?(name)

    content_type STATIC_FILES[name]
    headers 'X-Content-Type-Options' => 'nosniff'
    send_file Settings::PUBLIC_DIR / name
  end

  # The pages link their assets relatively, so the payment page only works on the trailing-slash
  # form of the prefix.
  get BASE do
    redirect "#{BASE}/", 307
  end

  not_found do
    content_type 'text/plain; charset=utf-8'
    headers 'X-Content-Type-Options' => 'nosniff'
    "404 page not found\n"
  end

  private

  # Both pages are served straight off disk, with nothing substituted into them. erb is in the
  # box here, and using it on a view would end the promise that the same HTML serves from every
  # example.
  def send_view(name)
    headers 'Content-Security-Policy' => CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
            # The page carries the signed order parameters in its URL, and it is one payment's page
            'Cache-Control' => 'no-store'
    content_type 'text/html; charset=utf-8'
    send_file Settings::VIEWS_DIR / name
  end

  # window.CONFIG as a script of its own: the only thing this server generates.
  def send_config_js(config)
    content_type 'text/javascript; charset=utf-8'
    # The ticket inside is single-use, so this must never come from a cache
    headers 'Cache-Control' => 'no-store'
    # JSON.generate is already compact and leaves non-ASCII alone, which is what JSON.stringify
    # emits. The keys come out in insertion order, as in the Express and Flask examples; Go and
    # PHP sort theirs.
    "window.CONFIG = #{JSON.generate(config)};\n"
  end

  # {BASE_PATH}/result with the four signed parameters, in the order the page wants them.
  #
  # Built from SIGNED_CALLBACK_FIELDS rather than from the form's own order, so every example
  # sends the payer to the identical URL.
  def result_url(callback)
    signed = Control::SIGNED_CALLBACK_FIELDS
                .reject { |name| callback[name].to_s.empty? }
                .map { |name| [name, callback[name]] }
    query = URI.encode_www_form(signed)
    query.empty? ? "#{BASE}/result" : "#{BASE}/result?#{query}"
  end

  # The merchant's own identifier for the order.
  #
  # Random rather than sequential or clock-based: the page hands it back on every /status poll, so
  # an id that can be guessed would make somebody else's order readable — and two payers in the
  # same millisecond would have collided.
  def new_client_order_id
    "hf-#{SecureRandom.hex(16)}"
  end

  # Keeps the allowed fields and drops everything else.
  #
  # The last two come from the request headers, never from the body, so the caller cannot spoof
  # them. Presence is the test, so a field the page sends empty is forwarded empty.
  def pick_browser(source)
    browser = {}
    BROWSER_FIELDS.each do |name|
      browser[name] = source[name].to_s if source.key?(name)
    end
    accept = request.env['HTTP_ACCEPT'].to_s
    browser['customer_browser_accept_header'] = accept.empty? ? '*/*' : accept
    browser['customer_browser_user_agent'] = request.env['HTTP_USER_AGENT'].to_s
    browser
  end

  # The four payer details the Sale takes from our own inputs, as strings whatever arrived.
  def payer_details(customer)
    %w[firstName lastName email cardPrintedName].to_h { |name| [name, customer[name].to_s] }
  end

  # The payer's address, which the platform uses for fraud screening.
  #
  # Read straight out of the header rather than through request.ip: Rack has changed which end of
  # X-Forwarded-For it trusts between versions, and every example here documents taking the
  # leftmost entry. Behind nginx that is the only place the address arrives, and it is taken on
  # trust — one of the reasons the app listens on loopback by default.
  def client_ip
    forwarded = request.env['HTTP_X_FORWARDED_FOR'].to_s
    address = forwarded.empty? ? request.env['REMOTE_ADDR'].to_s : forwarded.split(',').first.to_s.strip

    return '127.0.0.1' if address == '::1'

    address.delete_prefix('::ffff:')
  end

  def json_body(body)
    content_type 'application/json'
    "#{JSON.generate(body)}\n"
  end

  def halt_json(status, body)
    halt status, { 'Content-Type' => 'application/json' }, "#{JSON.generate(body)}\n"
  end

  # Any gateway failure surfaces to the page as one 502 with a message.
  def fail_json(error)
    Paynet::LOG.error("[error] #{error.message}")
    halt_json(502, 'error' => error.message)
  end
end

if __FILE__ == $PROGRAM_NAME
  # The development server. Behind nginx this branch never runs — puma reads config.ru instead.
  HostedFieldsExample.run!
end
