<?php

/**
 * Golden fixtures produced by Laravel's own classes (no HTTP, no database):
 * - pagination.json: resource-collection envelopes from LengthAwarePaginator,
 *   for 0, 1, 16 and 200 records, valid/invalid/out-of-range pages, large
 *   windows, and query strings with and without withQueryString().
 * - signed-urls.json: URL::temporarySignedRoute(..., absolute: false) for the
 *   export download route, with a fixed clock and key.
 *
 * php test/fixtures/laravel/scripts/golden-fixtures.php
 */

declare(strict_types=1);

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Pagination\Paginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\URL;

[$root] = require __DIR__.'/_bootstrap.php';

$out = $root.'/test/fixtures/laravel/golden';

function envelope(string $uri, int $total, int $perPage, bool $keepQuery): array
{
    $request = Request::create($uri);
    // The global middleware the app runs before controllers.
    (new Illuminate\Foundation\Http\Middleware\TrimStrings)->handle($request, fn ($r) => $r);
    (new Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull)->handle($request, fn ($r) => $r);
    app()->instance('request', $request);

    $page = Paginator::resolveCurrentPage();
    $items = [];
    for ($i = ($page - 1) * $perPage + 1; $i <= min($total, $page * $perPage); $i++) {
        $items[] = ['id' => $i];
    }
    $paginator = new LengthAwarePaginator($items, $total, $perPage, $page, [
        'path' => Paginator::resolveCurrentPath(),
    ]);
    if ($keepQuery) {
        $paginator->withQueryString();
    }

    $response = JsonResource::collection($paginator)->toResponse($request);

    return [
        'uri' => $uri,
        'total' => $total,
        'perPage' => $perPage,
        'keepQuery' => $keepQuery,
        'json' => $response->getContent(),
    ];
}

$base = 'http://api.example.test/api/v1/forms';
$cases = [];
foreach ([0, 1, 16, 200] as $total) {
    foreach (['', '?page=2', '?page=abc', '?page=0', '?page=-2', '?page[]=2', '?page=2.5', '?page=%202%20', '?page=99'] as $query) {
        $cases[] = envelope($base.$query, $total, 15, true);
    }
}
foreach ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 100, 189, 190, 191, 192, 193, 196, 199, 200, 201] as $page) {
    $cases[] = envelope($base.'?page='.$page, 200, 1, true);
}
foreach ([1, 5, 8, 9] as $page) {
    $cases[] = envelope($base.'?per_page=1&page='.$page, 13, 1, true);
    $cases[] = envelope($base.'?per_page=1&page='.$page, 14, 1, true);
}
$queries = [
    '?filter[read]=true&sort=-created_at&page=2&per_page=15',
    '?page=2&q=a%20b&tags[]=x&tags[]=y&empty=&blank=%20%20&name=%20Ann%20',
    '?z=1&a=2&page=2&filter[spam]=0&filter[read]=1',
    '?weird=%2F%3F%26%3D%2B%21%27%28%29%2A~&ünï=ç',
];
foreach ($queries as $query) {
    $cases[] = envelope($base.$query, 40, 15, true);
    $cases[] = envelope('http://api.example.test/api/v1/forms/01k6b6xz0000000000000000aa/notifications'.$query, 40, 15, false);
}
$cases[] = envelope('https://proxy.example.test:8443/api/v1/forms/?page=2', 40, 15, true);
write_json($out.'/pagination.json', $cases);

// Signed export download URLs (FormEntryExportResource::downloadUrl()).
config(['app.key' => 'base64:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=']);
Carbon::setTestNow(Carbon::parse('2026-01-02 03:04:05', 'UTC'));
$signed = [];
foreach (['01k6b6xz0000000000000000aa', '01k6b6xz0000000000000000ab'] as $id) {
    foreach ([5, 60] as $minutes) {
        $signed[] = [
            'key' => config('app.key'),
            'now' => Carbon::now()->getTimestamp(),
            'export' => $id,
            'minutes' => $minutes,
            'relative' => URL::temporarySignedRoute('entry-exports.download', now()->addMinutes($minutes), ['export' => $id], absolute: false),
        ];
    }
}
config(['app.key' => 'plain-text-key-without-prefix']);
$signed[] = [
    'key' => config('app.key'),
    'now' => Carbon::now()->getTimestamp(),
    'export' => '01k6b6xz0000000000000000aa',
    'minutes' => 5,
    'relative' => URL::temporarySignedRoute('entry-exports.download', now()->addMinutes(5), ['export' => '01k6b6xz0000000000000000aa'], absolute: false),
];
write_json($out.'/signed-urls.json', $signed);
