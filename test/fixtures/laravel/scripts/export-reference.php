<?php

/**
 * Exports Laravel reference data the validation engine reads at runtime:
 * - messages.json: `validation.*` English templates (`lang/en/validation.php`).
 * - timezones.json: `DateTimeZone::listIdentifiers(ALL)`, what the `timezone`
 *   rule accepts (Node's Intl list differs, ch. 4 §4.3).
 *
 * php test/fixtures/laravel/scripts/export-reference.php
 */

declare(strict_types=1);

[$root] = require __DIR__.'/_bootstrap.php';

$out = $root.'/src/common/validation/reference';

$messages = trans('validation', [], 'en');
unset($messages['custom'], $messages['attributes']);
write_json($out.'/messages.json', $messages);

write_json($out.'/timezones.json', DateTimeZone::listIdentifiers(DateTimeZone::ALL));
