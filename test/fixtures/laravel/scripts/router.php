<?php

/**
 * Router for `php -S` that runs the reference app with a fixed clock: every
 * request sees CAPTURE_CLOCK_BASE plus one second per request served so far
 * (counter in CAPTURE_CLOCK_FILE). Otherwise identical to Laravel's own
 * `artisan serve` router (vendor/.../Foundation/resources/server.php).
 */

declare(strict_types=1);

$publicPath = getcwd();
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '');
if ($uri !== '/' && file_exists($publicPath.$uri)) {
    return false;
}

require $publicPath.'/../vendor/autoload.php';

$clockFile = getenv('CAPTURE_CLOCK_FILE');
$tick = (int) @file_get_contents($clockFile);
file_put_contents($clockFile, (string) ($tick + 1));
Illuminate\Support\Carbon::setTestNow(
    Illuminate\Support\Carbon::createFromTimestampUTC((int) getenv('CAPTURE_CLOCK_BASE') + $tick)
);

require_once $publicPath.'/index.php';
