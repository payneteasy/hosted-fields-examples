# The PHP example, for docker-compose.yml at the repository root.
#
# One stage and no build: there is no Composer and nothing to compile. php:8.4-fpm already has
# curl, openssl and json, which is everything this app asks for.
#
# PHP-FPM rather than `php -S`, because that is what the example deploys as — deploy/nginx.conf
# sends every request under the prefix to index.php over FastCGI, and router.php says in its own
# header that it is not used at all under nginx. Running the built-in server here instead would
# leave the one piece of shipped configuration this whole compose setup exists to exercise
# untested.

FROM php:8.4-fpm

# The path is not free to choose: deploy/nginx.conf names it in SCRIPT_FILENAME, and that file
# is mounted into the nginx container unchanged.
WORKDIR /opt/hosted-fields-examples-php
COPY . .

# The pool. deploy/hosted-fields-examples-php.pool.conf is the one shipped for a system FPM at
# /etc/php/8.4/fpm/pool.d/; this is its compose counterpart at the path the official image uses,
# and it differs in exactly two ways, both forced:
#
#   - `clear_env = no`. The shipped pool inherits nothing and names every setting as an env[]
#     line, which is right when the pool file is the configuration. Here the settings come from
#     compose, and a pool that cleared the environment would not see one of them.
#   - `listen.mode = 0666`. The shipped pool scopes the socket to www-data, which works when one
#     host user runs both. nginx is a separate image here with its own uid.
#
# Everything else is kept: the socket path, the display_errors flag and the open_basedir the
# shipped pool uses in place of the systemd ProtectSystem= lines the other examples have.
RUN rm -f /usr/local/etc/php-fpm.d/*.conf \
 && printf '%s\n' \
    '[global]' \
    'daemonize = no' \
    '; php-fpm closes STDOUT on startup, so a log on /proc/self/fd/1 would go nowhere' \
    'error_log = /proc/self/fd/2' \
    'log_limit = 8192' \
    '' \
    '[hosted-fields-examples-php]' \
    'user = www-data' \
    'group = www-data' \
    '' \
    'listen = /run/php/hosted-fields-examples-php.sock' \
    'listen.mode = 0666' \
    '' \
    'pm = dynamic' \
    'pm.max_children = 10' \
    'pm.start_servers = 2' \
    'pm.min_spare_servers = 1' \
    'pm.max_spare_servers = 3' \
    '' \
    'clear_env = no' \
    '' \
    '; So that a PHP error reaches `docker compose logs php` rather than nowhere' \
    'access.log = /proc/self/fd/2' \
    'catch_workers_output = yes' \
    'decorate_workers_output = no' \
    '' \
    'php_admin_value[open_basedir] = /opt/hosted-fields-examples-php/:/run/secrets/' \
    'php_admin_flag[display_errors] = off' \
    'php_admin_flag[log_errors] = on' \
    'php_admin_value[error_log] = /proc/self/fd/2' \
    > /usr/local/etc/php-fpm.d/hosted-fields.conf

# The socket lives on a volume shared with the nginx container
RUN mkdir -p /run/php
