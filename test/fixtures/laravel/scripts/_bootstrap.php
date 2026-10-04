<?php

/**
 * Boots the reference Laravel app without serving requests. Nothing here
 * writes to the Laravel repo or its database.
 *
 * LARAVEL_PATH defaults to ../form-handler-headless-laravel next to this repo.
 */

declare(strict_types=1);

$root = dirname(__DIR__, 4);
$laravel = getenv('LARAVEL_PATH') ?: dirname($root).'/form-handler-headless-laravel';

if (! is_file($laravel.'/artisan')) {
    fwrite(STDERR, "Laravel app not found at {$laravel}. Set LARAVEL_PATH.\n");
    exit(1);
}

require $laravel.'/vendor/autoload.php';

$app = require $laravel.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

/** Writes pretty JSON with stable formatting (no escaped slashes or Unicode). */
function write_json(string $path, mixed $data): void
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
    file_put_contents($path, $json."\n");
    fwrite(STDOUT, "wrote {$path}\n");
}

return [$root, $laravel];
