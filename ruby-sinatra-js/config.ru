# frozen_string_literal: true

# The Rack entry point, for puma:
#
#     bundle exec puma -b tcp://127.0.0.1:3005 config.ru
#
# There is no `map` here on purpose. BASE_PATH is interpolated into the route patterns in app.rb,
# so this file and `ruby app.rb` serve the very same URLs.

require_relative 'app'

run HostedFieldsExample
