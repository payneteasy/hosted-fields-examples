<?php

declare(strict_types=1);

// php tests/run.php

require_once __DIR__ . '/harness.php';

stub_settings();

require_once __DIR__ . '/oauth_test.php';
require_once __DIR__ . '/control_test.php';
require_once __DIR__ . '/paynet_test.php';

exit(test_report());
