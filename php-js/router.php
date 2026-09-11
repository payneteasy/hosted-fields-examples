<?php

declare(strict_types=1);

// The `php -S` entry point:
//
//     php -S 127.0.0.1:3003 router.php
//
// It must never `return false`. That hands the request back to the built-in server, which would
// serve .env or execute paynet.php directly — the app root is the document root here. index.php
// answers every path itself and serves public/ through an allowlist, so there is nothing to
// delegate.
//
// Under nginx and PHP-FPM this file is not used at all: see deploy/nginx.conf, which sends every
// request under the prefix to index.php.

require __DIR__ . '/index.php';
