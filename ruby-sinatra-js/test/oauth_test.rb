# frozen_string_literal: true

# The signature base string is where OAuth quietly breaks: every part has to be percent-encoded to
# RFC 3986, and the standard library's usual escaper is not. A wrong byte here is a 401 from the
# gateway with nothing in the log to say why, so these are the vectors that pin it down.
#
# They are the same ones go-js/oauth_test.go, nodejs-express-js/src/oauth.test.js,
# php-js/tests/oauth_test.php and python-flask-js/tests/test_oauth.py use, so no example can
# drift away from the others on its own.

require 'minitest/autorun'

require_relative 'settings_stub'

# Before requiring the module under test: settings.rb validates on load, and oauth.rb reaches it
SettingsStub.apply

require_relative '../oauth'

class OAuthEncodeTest < Minitest::Test
  def test_is_rfc_3986
    # The five characters JavaScript's encodeURIComponent leaves alone and OAuth does not
    assert_equal '%21%27%28%29%2A', OAuth.encode("!'()*")
    # A space is %20, never +
    assert_equal 'John%20Smith', OAuth.encode('John Smith')
    # + is a literal plus, and must not survive as one
    assert_equal 'a%2Bb', OAuth.encode('a+b')
    # Unreserved characters are left exactly as they are
    assert_equal 'abcXYZ019-._~', OAuth.encode('abcXYZ019-._~')
    # Non-ASCII is encoded per UTF-8 byte
    assert_equal '%C3%A9', OAuth.encode('é')
  end

  def test_escapes_the_slash
    # A URL is one parameter of the base string, so it has to be encoded whole
    assert_equal 'https%3A%2F%2Fgateway.example%2Fx', OAuth.encode('https://gateway.example/x')
  end
end

class OAuthBaseStringTest < Minitest::Test
  def test_sorts_and_encodes_each_part_once
    base = OAuth.base_string(
      'post',
      'https://gateway.example/paynet/api/v4/sale/123',
      { 'oauth_consumer_key' => 'merchant', 'amount' => '1.00', 'client_orderid' => 'hf-1' }
    )

    # METHOD is upper-cased, the URL is encoded whole, and the parameter list is encoded again
    assert_equal 'POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&' \
                 'amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant',
                 base
  end

  def test_orders_by_key_not_by_insertion
    ordered = OAuth.base_string('POST', 'https://gateway.example/x', { 'a' => '1', 'b' => '2' })
    shuffled = OAuth.base_string('POST', 'https://gateway.example/x', { 'b' => '2', 'a' => '1' })
    assert_equal ordered, shuffled
  end

  def test_an_empty_parameter_still_takes_part
    # A Sale sends card_printed_name empty when the page has no holder name, and the gateway signs
    # what it receives — so the name belongs in the base string with nothing after the =.
    base = OAuth.base_string('POST', 'https://gateway.example/x', { 'card_printed_name' => '' })
    assert_equal 'POST&https%3A%2F%2Fgateway.example%2Fx&card_printed_name%3D', base
  end
end
