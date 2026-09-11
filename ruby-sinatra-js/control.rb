# frozen_string_literal: true

# The 3DS return callback: the checksum the gateway signs it with, and the fields that travel on.
# https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html
#
# This lives apart from app.rb so it can be tested without starting a listener. Go keeps the same
# function in main.go, Express in src/callback.js, PHP in control.php, Python in control.py and
# Next.js in src/shared/lib/callback.ts; all of them must agree.

require 'digest'
require 'openssl'

require_relative 'settings'

module Control
  # The parameters the gateway signs its callback with, in the order the page wants them back
  SIGNED_CALLBACK_FIELDS = %w[status orderid merchant_order control].freeze

  # Takes a form body or a query hash: the same values travel on to /result, and are checked
  # again there with this very function.
  def self.valid_callback?(source)
    field = ->(name) { source[name].to_s }

    signed = field['status'] + field['orderid'] + field['merchant_order'] + Settings::MERCHANT_CONTROL
    expected = Digest::SHA1.hexdigest(signed)

    # secure_compare is constant time and answers false on a length mismatch, where
    # fixed_length_secure_compare raises on one — and a wrong length is already a wrong checksum.
    OpenSSL.secure_compare(expected, field['control'])
  end
end
