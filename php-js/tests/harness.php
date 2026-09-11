<?php

declare(strict_types=1);

// A test runner in thirty lines. The example has no dependencies and a test framework would be
// the first one, so `php tests/run.php` is the whole story.

/** @internal the tally test_report() prints */
final class Tests
{
    public static int $run = 0;
    public static int $failed = 0;
}

/**
 * The settings are validated on first use and every module under test reaches them. Nothing here
 * signs anything or calls the gateway, so the values only have to be present — except
 * MERCHANT_CONTROL, which the callback checksum is built from.
 *
 * These go in $_SERVER rather than the real environment, which env() reads first: a value already
 * exported in the shell wins, exactly as it does for the Express example's stub.
 */
const STUB_MERCHANT_CONTROL = 'test-merchant-control';

function stub_settings(): void
{
    $_SERVER['API_URL'] ??= 'https://gateway.example/paynet';
    $_SERVER['SDK_URL'] ??= 'https://gateway.example/assets/hosted-fields.js';
    $_SERVER['ENDPOINT_ID'] ??= '1234567';
    $_SERVER['MERCHANT_LOGIN'] ??= 'test-merchant';
    $_SERVER['MERCHANT_CONTROL'] ??= STUB_MERCHANT_CONTROL;
    $_SERVER['PRIVATE_KEY'] ??= 'not a key: nothing here signs anything';
}

function test(string $name, callable $body): void
{
    Tests::$run++;
    try {
        $body();
        printf("ok   %s\n", $name);
    } catch (Throwable $error) {
        Tests::$failed++;
        printf("FAIL %s\n     %s\n", $name, $error->getMessage());
    }
}

function expect_equals(mixed $actual, mixed $expected, string $what = ''): void
{
    if ($actual !== $expected) {
        throw new RuntimeException(sprintf(
            '%s got %s, want %s',
            $what === '' ? '' : $what . ':',
            var_export($actual, true),
            var_export($expected, true),
        ));
    }
}

function expect_true(bool $actual, string $what): void
{
    expect_equals($actual, true, $what);
}

function expect_false(bool $actual, string $what): void
{
    expect_equals($actual, false, $what);
}

/** @return int the exit code */
function test_report(): int
{
    printf("\n%d tests, %d failed\n", Tests::$run, Tests::$failed);

    return Tests::$failed === 0 ? 0 : 1;
}
