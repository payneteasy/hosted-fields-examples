# The Sinatra example, for docker-compose.yml at the repository root.
#
# One stage, and the full ruby image rather than -slim: puma's nio4r is a native extension and
# needs a compiler, so a slim runtime would have to carry one anyway.

FROM ruby:3.1
# BUNDLE_PATH as an environment variable rather than `bundle config`, which would write a
# .bundle/config into the app directory — the same reason the systemd unit sets it this way.
ENV BUNDLE_PATH=/opt/hosted-fields-examples-ruby/vendor/bundle \
    BUNDLE_WITHOUT=development:test

WORKDIR /opt/hosted-fields-examples-ruby
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . .

# puma, not `ruby app.rb`: that branch is Sinatra's development server. This is the unit's
# ExecStart, and shell form for the same reason as the Flask image — puma reads the two names
# off its command line.
CMD bundle exec puma --bind tcp://${LISTEN_ADDR:-127.0.0.1}:${PORT:-3005} config.ru
