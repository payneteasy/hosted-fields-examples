# frozen_string_literal: true

# All settings come from the environment, see .env.example.
#
# The five gateway settings are validated when this file is required, which for both
# `ruby app.rb` and puma is the startup: the app refuses to boot rather than serving a page that
# cannot take a payment. `ruby -c` does not load anything and the tests stub the environment, so
# neither needs credentials.

require 'pathname'
require 'uri'

module Settings
  APP_DIR = Pathname.new(__dir__).realpath
  # Copies of shared/, kept in step by scripts/sync-shared.sh. public/ is reachable through the
  # allowlisted route in app.rb and views/ is not reachable at all: the two pages are read and
  # sent by hand.
  PUBLIC_DIR = APP_DIR / 'public'
  VIEWS_DIR = APP_DIR / 'views'

  # Reads a KEY=value file, the way `node --env-file` does. A missing file is not an error.
  #
  # Nothing here touches ENV: the values are returned and consulted *after* the real environment,
  # which is what lets a harness drive the app without writing an .env and keeps a stale .env
  # from winning over what the process was started with.
  def self.read_env_file(path)
    values = {}
    return values unless File.readable?(path)

    File.readlines(path, chomp: true).each do |line|
      line = line.strip
      next if line.empty? || line.start_with?('#')

      # The first = separates, so a value may contain more of them
      name, separator, value = line.partition('=')
      next if separator.empty?

      values[name.strip] = value.strip.gsub(/\A["']|["']\z/, '')
    end

    values
  end

  ENV_FILE = read_env_file(APP_DIR / '.env')

  # One setting: the real environment first, then .env, then the fallback. An empty value counts
  # as unset, so a copied .env.example fails with a message naming what is missing rather than
  # half working.
  def self.env(name, fallback = '')
    value = ENV[name]
    value = ENV_FILE[name] if value.nil? || value.empty?
    value.nil? || value.empty? ? fallback : value
  end

  # Scheme, host and port of a URL, or '' when it is not one.
  def self.origin(url)
    parsed = URI.parse(url)
    return '' if parsed.scheme.nil? || parsed.host.nil?

    port = parsed.port && parsed.port != parsed.default_port ? ":#{parsed.port}" : ''
    "#{parsed.scheme}://#{parsed.host}#{port}"
  rescue URI::InvalidURIError
    ''
  end

  # The signing key, as text. A path is tried first, and one that cannot be read is fatal.
  def self.private_key
    path = env('PRIVATE_KEY_PATH')
    return File.read(path) unless path.empty?

    env('PRIVATE_KEY')
  end

  PORT = Integer(env('PORT', '3005'))
  # Interface to listen on. The default is loopback: the example speaks plain HTTP and trusts
  # X-Forwarded-For, both of which are only safe with a proxy in front. Set 0.0.0.0 knowingly.
  LISTEN_ADDR = env('LISTEN_ADDR', '127.0.0.1')
  BASE_PATH = env('BASE_PATH', '/hosted-fields-examples-ruby')
  PUBLIC_URL = env('PUBLIC_URL', "http://localhost:#{PORT}")

  # No defaults: the gateway host is per-installation, and a stale one baked in here would
  # silently point a real payment somewhere it does not belong. Required below.
  API_URL = env('API_URL')
  SDK_URL = env('SDK_URL')
  # Origin of SDK_URL, scheme and host only: the Content-Security-Policy has to name the host the
  # SDK bundle and the card iframes come from, and nothing else.
  SDK_ORIGIN = origin(SDK_URL)

  ENDPOINT_ID = env('ENDPOINT_ID')
  MERCHANT_LOGIN = env('MERCHANT_LOGIN')
  # Shared secret the gateway signs its callbacks with. Not the RSA key.
  MERCHANT_CONTROL = env('MERCHANT_CONTROL')
  # The key is a multi-line PEM, which neither systemd's EnvironmentFile nor most secret stores
  # handle well, so a path is the deployment-friendly form and the inline value the local one.
  PRIVATE_KEY = private_key

  ORDER_AMOUNT = env('ORDER_AMOUNT', '1.00')
  ORDER_CURRENCY = env('ORDER_CURRENCY', 'USD')

  # Where the gateway sends the payer back after a 3DS challenge. It POSTs there, so this is
  # /result/callback and not the /result page the callback then redirects to. Built from
  # PUBLIC_URL, because behind a proxy the listen address is not what the payer's browser sees.
  REDIRECT_URL = "#{PUBLIC_URL}#{BASE_PATH}/result/callback"

  {
    'API_URL' => API_URL,
    'SDK_URL' => SDK_URL,
    'ENDPOINT_ID' => ENDPOINT_ID,
    'MERCHANT_LOGIN' => MERCHANT_LOGIN,
    'MERCHANT_CONTROL' => MERCHANT_CONTROL
  }.each do |name, value|
    raise "#{name} is not set, see .env.example" if value.empty?
  end

  raise 'Set PRIVATE_KEY_PATH or PRIVATE_KEY, see .env.example' if PRIVATE_KEY.empty?
end
