<?php

/**
 * Runs every case in test/fixtures/validation/spec.json through Laravel's
 * Validator and records the outcome in corpus.json, the source of truth for
 * the TypeScript engine's table-driven tests (ch. 4 §4.3). Re-run whenever
 * the spec changes or a rule is added.
 *
 * php test/fixtures/laravel/scripts/validation-corpus.php
 */

declare(strict_types=1);

use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

[$root] = require __DIR__.'/_bootstrap.php';

$dir = $root.'/test/fixtures/validation';
$spec = json_decode(file_get_contents($dir.'/spec.json'), true, flags: JSON_THROW_ON_ERROR);

function run_case(array $rules, array $data): array
{
    $validator = Validator::make($data, $rules);
    try {
        $passes = $validator->passes();
    } catch (BadMethodCallException $e) {
        // An unknown rule name: Laravel answers 500 (the F7 bug, ch. 4 §4.5).
        return ['throws' => 'BadMethodCallException'];
    }
    $errors = [];
    foreach ($validator->errors()->messages() as $key => $messages) {
        $errors[] = [(string) $key, $messages];
    }

    return [
        'passes' => $passes,
        'message' => $passes ? null : (new ValidationException($validator))->getMessage(),
        'errors' => $errors,
        // Encoded here so the TS side compares exact JSON (key order, lists vs objects).
        'validated' => $passes
            ? json_encode($validator->validated(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            : null,
    ];
}

$single = [];
foreach ($spec['ruleSets'] as $ruleSet) {
    $single[] = ['rules' => $ruleSet, 'absent' => true] + run_case(['field' => $ruleSet], []);
    foreach ($spec['values'] as $value) {
        $single[] = ['rules' => $ruleSet, 'value' => $value] + run_case(['field' => $ruleSet], ['field' => $value]);
    }
}

$cases = [];
foreach ($spec['cases'] as $case) {
    $cases[] = ['name' => $case['name']] + run_case($case['rules'], $case['data']);
}

$trim = array_map(fn (string $s): array => [$s, Str::trim($s)], $spec['trim']);

// parse_str() is what PHP uses for query strings and urlencoded bodies.
$queries = array_map(function (string $q): array {
    parse_str($q, $result);

    return [$q, json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)];
}, $spec['queries']);

$json = json_encode(
    ['laravel' => app()->version(), 'single' => $single, 'cases' => $cases, 'trim' => $trim, 'queries' => $queries],
    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
);
file_put_contents($dir.'/corpus.json', $json."\n");
fwrite(STDOUT, sprintf("wrote %s (%d single, %d cases)\n", $dir.'/corpus.json', count($single), count($cases)));
