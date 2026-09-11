# frozen_string_literal: true

# OAuth 1.0a RSA-SHA256 request signing.
# https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html

require 'base64'
require 'erb'
require 'openssl'
require 'securerandom'

require_relative 'settings'

module OAuth
  # RFC 3986 percent encoding.
  #
  # ERB::Util.url_encode escapes everything but A-Za-z0-9_.~-, which is exactly the unreserved
  # set. CGI.escape is the trap: it is form encoding, writes a space as +, and leaves the
  # signature wrong with nothing in the gateway's reply to say why.
  def self.encode(value)
    ERB::Util.url_encode(value.to_s)
  end

  # The signature base string: METHOD&url&sorted-parameters, each part percent-encoded.
  #
  # It carries no secret, which is what makes it testable on its own — and it is where a signature
  # usually goes wrong, because every part has to be encoded to RFC 3986 rather than to the looser
  # rules the standard library applies elsewhere.
  def self.base_string(method, url, params)
    normalized = params.keys.sort.map { |key| "#{encode(key)}=#{encode(params[key])}" }.join('&')
    "#{method.upcase}&#{encode(url)}&#{encode(normalized)}"
  end

  # Builds the Authorization header for a signed API call.
  # body_params are the x-www-form-urlencoded parameters of the request, if any.
  def self.auth_header(method, url, body_params = {})
    oauth_params = {
      'oauth_consumer_key' => Settings::MERCHANT_LOGIN,
      'oauth_nonce' => SecureRandom.hex(16),
      'oauth_signature_method' => 'RSA-SHA256',
      'oauth_timestamp' => Time.now.to_i.to_s,
      'oauth_version' => '1.0'
    }

    # Body parameters first, so an oauth_* name can never be taken from the request
    base = base_string(method, url, body_params.merge(oauth_params))
    signature = signing_key.sign(OpenSSL::Digest.new('SHA256'), base)

    header = oauth_params.merge('oauth_signature' => Base64.strict_encode64(signature))
    # Header values are not encoded by the transport, so encode them here
    "OAuth #{header.map { |key, value| %(#{key}="#{encode(value)}") }.join(', ')}"
  end

  # The parsed signing key.
  #
  # Accepts a PKCS#8 or PKCS#1 PEM, with real newlines or with escaped \n, so the key can also
  # live on a single line in an env variable. RSA#sign is PKCS#1 v1.5, which is what Go's
  # rsa.SignPKCS1v15, PHP's openssl_sign and Python's padding.PKCS1v15 produce.
  def self.signing_key
    @signing_key ||= begin
      key = OpenSSL::PKey::RSA.new(Settings::PRIVATE_KEY.gsub('\n', "\n"))
      raise 'the private key is not RSA, an RSA key is required' unless key.is_a?(OpenSSL::PKey::RSA)

      key
    end
  end
end
