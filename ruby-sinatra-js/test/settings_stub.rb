# frozen_string_literal: true

# settings.rb validates when it is required, and every module under test reaches it through
# require_relative. The tests do not sign anything and do not call the gateway, so the values only
# have to be present — except MERCHANT_CONTROL, which the callback checksum is built from.
#
# They go into ENV, which Settings.env reads first, so a value already exported in the shell wins.
# That is the same bargain nodejs-express-js/src/settings-stub.js makes.

module SettingsStub
  MERCHANT_CONTROL = 'test-merchant-control'

  STUB = {
    'API_URL' => 'https://gateway.example/paynet',
    'SDK_URL' => 'https://gateway.example/assets/hosted-fields.js',
    'ENDPOINT_ID' => '1234567',
    'MERCHANT_LOGIN' => 'test-merchant',
    'MERCHANT_CONTROL' => MERCHANT_CONTROL,
    'PRIVATE_KEY' => 'not a key: nothing here signs anything'
  }.freeze

  def self.apply
    STUB.each { |name, value| ENV[name] = value if ENV[name].nil? || ENV[name].empty? }
  end
end
