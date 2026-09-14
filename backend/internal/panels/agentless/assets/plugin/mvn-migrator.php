<?php
/**
 * Plugin Name: Site Migration Helper
 * Description: Temporary helper installed while this site is being migrated to a new host. It removes itself automatically when the migration finishes.
 * Version:     1.0.0
 * License:     GPL-2.0-or-later
 * Requires PHP: 7.2
 *
 * Wrapper around mig-agent.php (same directory). The agent is included with
 * MIG_AGENT_PLUGIN_MODE defined, so nothing runs at include time; requests arrive through
 * admin-ajax.php?action=mig_helper&mig_action=<a>&token=<t> (logged in or not) and are
 * token-gated exactly like the standalone helper. The token, expiry and allowed IP are baked
 * into this file (__TOKEN__, __EXPIRES__, __ALLOWED_IP__) and copied into the option
 * mig_helper_token on activation. cleanup deletes the temp dir, the option and the plugin.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!defined('MIG_AGENT_PLUGIN_MODE')) {
    define('MIG_AGENT_PLUGIN_MODE', true);
}
if (!defined('MIG_HELPER_TOKEN')) {
    define('MIG_HELPER_TOKEN', '__TOKEN__');
    define('MIG_HELPER_EXPIRES', '__EXPIRES__');
    define('MIG_HELPER_ALLOWED_IP', '__ALLOWED_IP__');
}

require_once dirname(__FILE__) . '/mig-agent.php';

/** Option payload written on activation. */
function mig_helper_option_value()
{
    $ip = (string) MIG_HELPER_ALLOWED_IP;
    if ($ip === '__' . 'ALLOWED_IP__') {
        $ip = '';
    }
    return array(
        'token' => (string) MIG_HELPER_TOKEN,
        'expires' => is_numeric(MIG_HELPER_EXPIRES) ? (int) MIG_HELPER_EXPIRES : 0,
        'allowed_ip' => $ip,
        'installed' => time(),
    );
}

function mig_helper_activate()
{
    delete_option('mig_helper_token');
    add_option('mig_helper_token', mig_helper_option_value(), '', 'no');
}

function mig_helper_deactivate()
{
    delete_option('mig_helper_token');
}

register_activation_hook(__FILE__, 'mig_helper_activate');
register_deactivation_hook(__FILE__, 'mig_helper_deactivate');

/** admin-ajax entry (both logged-in and anonymous). Never returns. */
function mig_helper_ajax()
{
    mig_agent_plugin_request();
    exit;
}

add_action('wp_ajax_nopriv_mig_helper', 'mig_helper_ajax');
add_action('wp_ajax_mig_helper', 'mig_helper_ajax');

/**
 * Called by the agent's cleanup action: delete the option, deactivate the plugin and remove
 * its files (delete_plugins, then a direct removal as fallback). Returns true when the
 * plugin directory is gone.
 */
function mig_helper_self_destruct()
{
    delete_option('mig_helper_token');
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
        MigUtil::rmTree($dir);
    }
    if (function_exists('wp_clean_plugins_cache')) {
        @wp_clean_plugins_cache(true);
    }
    clearstatcache();
    return !is_dir($dir);
}
