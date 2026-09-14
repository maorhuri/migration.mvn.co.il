<?php
/**
 * Plugin Name: MVN Migrator
 * Plugin URI:  https://mvn.co.il/
 * Description: Temporary helper installed by the MVN migration tool while this site is being migrated. It removes itself when the migration finishes.
 * Version:     1.0.0
 * Author:      MVN
 * License:     GPL-2.0-or-later
 * Requires PHP: 7.2
 *
 * Wrapper around mvn-agent.php (same directory). The agent is included with
 * MVN_AGENT_PLUGIN_MODE defined, so nothing runs at include time; requests arrive through
 * admin-ajax.php?action=mvn_migrator&mvn_action=<a>&token=<t> (logged in or not) and are
 * token-gated exactly like the standalone helper. The token, expiry and allowed IP are baked
 * into this file (__TOKEN__, __EXPIRES__, __ALLOWED_IP__) and copied into the option
 * mvn_migrator_token on activation. cleanup deletes the temp dir, the option and the plugin.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!defined('MVN_AGENT_PLUGIN_MODE')) {
    define('MVN_AGENT_PLUGIN_MODE', true);
}
if (!defined('MVN_MIGRATOR_TOKEN')) {
    define('MVN_MIGRATOR_TOKEN', '__TOKEN__');
    define('MVN_MIGRATOR_EXPIRES', '__EXPIRES__');
    define('MVN_MIGRATOR_ALLOWED_IP', '__ALLOWED_IP__');
}

require_once dirname(__FILE__) . '/mvn-agent.php';

/** Option payload written on activation. */
function mvn_migrator_option_value()
{
    $ip = (string) MVN_MIGRATOR_ALLOWED_IP;
    if ($ip === '__' . 'ALLOWED_IP__') {
        $ip = '';
    }
    return array(
        'token' => (string) MVN_MIGRATOR_TOKEN,
        'expires' => is_numeric(MVN_MIGRATOR_EXPIRES) ? (int) MVN_MIGRATOR_EXPIRES : 0,
        'allowed_ip' => $ip,
        'installed' => time(),
    );
}

function mvn_migrator_activate()
{
    delete_option('mvn_migrator_token');
    add_option('mvn_migrator_token', mvn_migrator_option_value(), '', 'no');
}

function mvn_migrator_deactivate()
{
    delete_option('mvn_migrator_token');
}

register_activation_hook(__FILE__, 'mvn_migrator_activate');
register_deactivation_hook(__FILE__, 'mvn_migrator_deactivate');

/** admin-ajax entry (both logged-in and anonymous). Never returns. */
function mvn_migrator_ajax()
{
    mvn_agent_plugin_request();
    exit;
}

add_action('wp_ajax_nopriv_mvn_migrator', 'mvn_migrator_ajax');
add_action('wp_ajax_mvn_migrator', 'mvn_migrator_ajax');

/**
 * Called by the agent's cleanup action: delete the option, deactivate the plugin and remove
 * its files (delete_plugins, then a direct removal as fallback). Returns true when the
 * plugin directory is gone.
 */
function mvn_migrator_self_destruct()
{
    delete_option('mvn_migrator_token');
    $plugin = plugin_basename(__FILE__);
    $dir = dirname(__FILE__);
    if (!function_exists('deactivate_plugins') || !function_exists('delete_plugins')) {
        @include_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    if (!function_exists('request_filesystem_credentials')) {
        @include_once ABSPATH . 'wp-admin/includes/file.php';
    }
    if (function_exists('deactivate_plugins')) {
        @deactivate_plugins($plugin, true);
    }
    if (function_exists('delete_plugins')) {
        if (!defined('FS_METHOD')) {
            define('FS_METHOD', 'direct');
        }
        ob_start();
        @delete_plugins(array($plugin));
        ob_end_clean();
    }
    clearstatcache();
    if (is_dir($dir)) {
        MvnUtil::rmTree($dir);
    }
    if (function_exists('wp_clean_plugins_cache')) {
        @wp_clean_plugins_cache(true);
    }
    clearstatcache();
    return !is_dir($dir);
}
