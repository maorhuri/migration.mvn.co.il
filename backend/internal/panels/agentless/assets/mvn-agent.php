<?php
/**
 * Site migration helper agent (mig-agent.php).
 *
 * Temporary helper this migration tool uploads to a customer's web root. One file,
 * PHP >= 7.2, no dependencies, runs under max_execution_time=30 / memory_limit=128M and
 * removes itself on cleanup. Authoritative contract: docs/agentless-protocol.md in the tool.
 *
 * Configuration is baked in by literal replacement of the placeholders below:
 *   __TOKEN__       32 hex chars, shared secret (an unreplaced/invalid token refuses HTTP)
 *   __ALLOWED_IP__  client IP compared with REMOTE_ADDR (comma list allowed); empty = any
 *   __EXPIRES__     unix timestamp after which every HTTP request gets 403
 *   __DOCROOT__     absolute docroot; empty = the directory holding this file
 *
 * Invocation
 *   HTTP    <site>/<name>.php?action=<a>&token=<t>[&k=v]  (token also in header X-MT-Token,
 *           parameters also accepted as POST fields). Responses are JSON, HTTP 200:
 *           {"ok":true,...} or {"ok":false,"error":"..."}; 403 bad/expired token or wrong IP;
 *           404 unknown file (get); 416 bad Range. Every response: Cache-Control: no-store.
 *   CLI     php mig-agent.php <action> key=value ...  Env MIG_DOCROOT overrides the docroot,
 *           env MIG_TMP places the temp dir elsewhere. No token/IP/expiry check in CLI.
 *   Plugin  included by mig-helper.php with MIG_AGENT_PLUGIN_MODE defined. Nothing runs at
 *           include time; the plugin calls mig_agent_plugin_request() from admin-ajax.php
 *           (action=mig_helper&mig_action=<a>&token=<t>), token/expiry from the option
 *           mig_helper_token, docroot = ABSPATH.
 *
 * Temp dir  <docroot>/.mig-tmp-<8 hex>/ (with .htaccess "deny" and an empty index.html) holds
 *           every state file and artifact. info returns it as tmp_dir (absolute path) and
 *           tmp_dir_name (basename).
 *
 * Actions
 *   info     {ok, php_version, exec, wordpress, wp_version, table_prefix, multisite, site_url,
 *            db:{name,user,host}, docroot, tmp_dir, tmp_dir_name, disk_free, max_execution_time,
 *            memory_limit, files:{count,bytes,partial}, plugins:{active,litespeed_cache,
 *            wp_rocket,object_cache}}. Never the DB password. files = walk with a 15 s budget
 *            using the archive exclusions.
 *   dump     chunked/resumable database dump. Every call works about 20 s and returns
 *            {ok,done:false,mode,progress:{tables_done,tables_total,rows,bytes}} until
 *            {ok,done:true,mode,file,size,tables,views}.
 *            mode "exec":   mysqldump/mariadb-dump | gzip in the background, polled.
 *                           file "db.sql.gz", or "db.sql" when the host has no gzip binary.
 *            mode "mysqli": PHP streams the SQL itself (tables + data-less views, no
 *                           triggers/routines). file "db.sql.gz", or "db.sql" without zlib.
 *            Optional db_host, db_user, db_pass, db_name override wp-config.php. restart=1
 *            discards the current dump. State: <tmp>/dump.state.json.
 *   archive  chunked/resumable tar of the docroot, paths relative to the docroot, symlinks
 *            stored as symlinks, exclusions from the contract. Returns
 *            {ok,done:false,mode,progress:{files,bytes,files_total,bytes_total,phase}} until
 *            {ok,done:true,mode,parts:[{file,size}],files,bytes,notes}.
 *            mode "exec": tar | gzip in the background. When the docroot is over 1 GB and the
 *                         output is over 1 GB it is split into parts "files.tar.gz.aa",
 *                         "files.tar.gz.ab", ... (concatenate in the listed order); otherwise
 *                         one part "files.tar.gz" ("files.tar" when the host has no gzip).
 *            mode "php":  pure-PHP ustar writer (GNU long names), one "files.tar.gz"
 *                         ("files.tar" without zlib). Gzip output written by PHP is
 *                         multi-member (one member per call); gunzip, tar, and Go read it.
 *            restart=1 starts over. State: <tmp>/archive.state.json.
 *   get      &file=<name>: raw bytes of a file inside the temp dir. Content-Length,
 *            Accept-Ranges: bytes, one HTTP Range (206 + Content-Range), HEAD supported.
 *   cleanup  stops background jobs, deletes the temp dir and this file (FTP mode) or the
 *            option + plugin (plugin mode). {ok:true, ...}
 *
 * A call arriving while another call of the same action is still running returns
 * {ok:false,error:"busy",busy:true}; poll again a little later.
 *
 * Notes for the client
 *   - Chunked calls return early when the work finishes; exec-mode polls wait at most 5 s so
 *     progress arrives often. Every call is guaranteed to make progress (at least one
 *     directory / entry / batch) even on hosts where the budget is tiny.
 *   - A failed call leaves the state untouched; the next call resumes from the last committed
 *     state (the output file is truncated back to its committed size first).
 *   - mysqldump failures fall back to mysqli mode automatically (note in "notes").
 *   - exec-mode tar stores a top-level entry whose name starts with "-" as "./-name".
 *   - Extra fields beyond the contract (mysqli, zlib, exec_tools, db_size, db_tables,
 *     tmp_dir_name, mode, notes, rows, views, elapsed, out_bytes, ...) are informational.
 *   - Tests: env MIG_BUDGET=<seconds> (CLI only) shortens the per-call budget.
 */

if (!defined('MIG_CFG_TOKEN')) {
    define('MIG_CFG_TOKEN', '__TOKEN__');
    define('MIG_CFG_ALLOWED_IP', '__ALLOWED_IP__');
    define('MIG_CFG_EXPIRES', '__EXPIRES__');
    // nowdoc: the replaced path may contain quotes or backslashes without breaking the file
    define('MIG_CFG_DOCROOT', trim(<<<'MIGDOCROOT'
__DOCROOT__
MIGDOCROOT
    ));
    define('MIG_AGENT_VERSION', '1.0.0');
    define('MIG_CALL_BUDGET', 20);      // seconds of work per chunked call
    define('MIG_INFO_WALK_BUDGET', 15); // seconds for the info file walk
    define('MIG_GZ_LEVEL', 6);          // deflate level for PHP-written gzip
    define('MIG_SQL_BATCH_BYTES', 500 * 1024);
    define('MIG_SQL_BATCH_ROWS', 1000);
    define('MIG_PART_BYTES', 1073741824); // 1 GB parts (exec mode)
}

/* ------------------------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------------------- */

class MigError extends Exception
{
    public $status;
    public $extra;

    public function __construct($message, $status = 200, $extra = array())
    {
        parent::__construct($message);
        $this->status = $status;
        $this->extra = $extra;
    }
}

final class MigUtil
{
    /** Functions listed in disable_functions (lowercase). */
    public static function disabledFunctions()
    {
        static $list = null;
        if ($list === null) {
            $list = array();
            $raw = (string) @ini_get('disable_functions');
            foreach (explode(',', $raw) as $f) {
                $f = strtolower(trim($f));
                if ($f !== '') {
                    $list[$f] = true;
                }
            }
        }
        return $list;
    }

    public static function callable_($name)
    {
        $d = self::disabledFunctions();
        return function_exists($name) && !isset($d[strtolower($name)]);
    }

    /** Best available function to run a shell command, or null. */
    public static function shellFunction()
    {
        static $fn = false;
        if ($fn === false) {
            $fn = null;
            foreach (array('proc_open', 'exec', 'popen', 'shell_exec', 'system', 'passthru') as $f) {
                if (self::callable_($f)) {
                    $fn = $f;
                    break;
                }
            }
        }
        return $fn;
    }

    /**
     * Run a shell command synchronously. Returns array(exit_code|null, stdout). stderr is
     * merged into stdout. $timeout in seconds (proc_open only).
     */
    public static function run($cmd, $timeout = 10)
    {
        $fn = self::shellFunction();
        if ($fn === null) {
            return array(null, '');
        }
        $cmd = $cmd . ' 2>&1';
        switch ($fn) {
            case 'proc_open':
                $desc = array(0 => array('file', '/dev/null', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w'));
                $p = @proc_open($cmd, $desc, $pipes);
                if (!is_resource($p)) {
                    return array(null, '');
                }
                @stream_set_blocking($pipes[1], false);
                $out = '';
                $deadline = microtime(true) + $timeout;
                while (true) {
                    $chunk = @fread($pipes[1], 65536);
                    if ($chunk !== false && $chunk !== '') {
                        $out .= $chunk;
                        continue;
                    }
                    $st = @proc_get_status($p);
                    if (!$st || !$st['running']) {
                        $rest = @stream_get_contents($pipes[1]);
                        if ($rest !== false) {
                            $out .= $rest;
                        }
                        break;
                    }
                    if (microtime(true) > $deadline) {
                        @proc_terminate($p, 9);
                        break;
                    }
                    usleep(20000);
                }
                @fclose($pipes[1]);
                @fclose($pipes[2]);
                $code = @proc_close($p);
                return array(is_int($code) ? $code : null, $out);
            case 'exec':
                $lines = array();
                $code = 1;
                @exec($cmd, $lines, $code);
                return array((int) $code, implode("\n", $lines));
            case 'popen':
                $h = @popen($cmd, 'r');
                if (!$h) {
                    return array(null, '');
                }
                $out = (string) @stream_get_contents($h);
                $code = @pclose($h);
                return array(is_int($code) ? $code : null, $out);
            case 'shell_exec':
                $out = @shell_exec($cmd);
                return array(null, (string) $out);
            case 'system':
                ob_start();
                $code = 1;
                @system($cmd, $code);
                $out = (string) ob_get_clean();
                return array((int) $code, $out);
            case 'passthru':
                ob_start();
                $code = 1;
                @passthru($cmd, $code);
                $out = (string) ob_get_clean();
                return array((int) $code, $out);
        }
        return array(null, '');
    }

    /** True when a shell can actually be spawned (probe once per process). */
    public static function execAvailable()
    {
        static $ok = null;
        if ($ok === null) {
            $ok = false;
            if (self::shellFunction() !== null) {
                list($code, $out) = self::run('echo probe-ok', 5);
                $ok = (strpos($out, 'probe-ok') !== false);
            }
        }
        return $ok;
    }

    /** Does a binary exist on PATH (exec mode only)? */
    public static function haveBinary($name)
    {
        static $cache = array();
        if (!isset($cache[$name])) {
            list($code, $out) = self::run('command -v ' . escapeshellarg($name), 5);
            $out = trim($out);
            $cache[$name] = ($out !== '' && $out[0] === '/') ? $out : '';
        }
        return $cache[$name];
    }

    /**
     * Start a shell script in the background (double fork, all fds detached) and return the
     * pid the script wrote into $pidFile, or 0.
     */
    public static function spawn($scriptPath, $pidFile)
    {
        @unlink($pidFile);
        $inner = 'sh ' . escapeshellarg($scriptPath) . ' </dev/null >/dev/null 2>&1';
        if (self::haveBinary('nohup') !== '') {
            $inner = 'nohup ' . $inner;
        } elseif (self::haveBinary('setsid') !== '') {
            $inner = 'setsid ' . $inner;
        }
        $cmd = '( ' . $inner . ' & ) >/dev/null 2>&1 </dev/null';
        self::run($cmd, 10);
        for ($i = 0; $i < 40; $i++) {
            clearstatcache();
            if (is_file($pidFile)) {
                $pid = (int) trim((string) @file_get_contents($pidFile));
                if ($pid > 0) {
                    return $pid;
                }
            }
            usleep(50000);
        }
        return 0;
    }

    /** Is the process alive? null = unknown (no way to tell on this host). */
    public static function pidAlive($pid)
    {
        $pid = (int) $pid;
        if ($pid <= 0) {
            return false;
        }
        if (@is_dir('/proc/' . $pid)) {
            // Linux: a zombie still has a /proc entry, treat it as gone.
            $stat = @file_get_contents('/proc/' . $pid . '/stat');
            if (is_string($stat) && preg_match('/\)\s+(\S)/', $stat, $m) && $m[1] === 'Z') {
                return false;
            }
            return true;
        }
        if (@is_dir('/proc/self')) {
            return false; // procfs works and the pid is gone
        }
        if (self::callable_('posix_kill')) {
            return @posix_kill($pid, 0);
        }
        if (self::execAvailable()) {
            list($code, $out) = self::run('kill -0 ' . $pid, 5);
            if (is_int($code)) {
                return $code === 0;
            }
        }
        return null;
    }

    public static function kill($pid)
    {
        $pid = (int) $pid;
        if ($pid <= 0) {
            return;
        }
        if (self::callable_('posix_kill')) {
            @posix_kill($pid, 15);
        } elseif (self::execAvailable()) {
            self::run('kill ' . $pid, 5);
        }
    }

    public static function bytesFromIni($v)
    {
        $v = trim((string) $v);
        if ($v === '' || $v === '-1') {
            return -1;
        }
        $last = strtolower(substr($v, -1));
        $n = (float) $v;
        switch ($last) {
            case 'g': $n *= 1024; // fall through
            case 'm': $n *= 1024; // fall through
            case 'k': $n *= 1024;
        }
        return (int) $n;
    }

    public static function jsonEncode($data)
    {
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR;
        if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
            $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
        }
        $s = @json_encode($data, $flags);
        if (!is_string($s)) {
            $s = '{"ok":false,"error":"json_encode failed"}';
        }
        return $s;
    }

    /** Recursively delete a directory (no symlink following). */
    public static function rmTree($dir)
    {
        if (is_link($dir) || !is_dir($dir)) {
            return @unlink($dir) || !file_exists($dir);
        }
        $ok = true;
        $h = @opendir($dir);
        if ($h) {
            while (($e = readdir($h)) !== false) {
                if ($e === '.' || $e === '..') {
                    continue;
                }
                $p = $dir . '/' . $e;
                if (!is_link($p) && is_dir($p)) {
                    $ok = self::rmTree($p) && $ok;
                } else {
                    $ok = @unlink($p) && $ok;
                }
            }
            closedir($h);
        }
        return @rmdir($dir) && $ok;
    }

    public static function ipMatches($allowed, $remote)
    {
        $remote = trim((string) $remote);
        foreach (explode(',', $allowed) as $ip) {
            $ip = trim($ip);
            if ($ip === '') {
                continue;
            }
            if ($ip === $remote) {
                return true;
            }
            $a = @inet_pton($ip);
            $b = @inet_pton($remote);
            if ($a !== false && $b !== false && $a === $b) {
                return true;
            }
        }
        return false;
    }

    public static function backtick($name)
    {
        return '`' . str_replace('`', '``', $name) . '`';
    }
}

/* ------------------------------------------------------------------------------------------
 * WordPress configuration and database access
 * ---------------------------------------------------------------------------------------- */

final class MigWp
{
    /** wp-config.php in the docroot, or one level up (WordPress allows that). */
    public static function findConfig($docroot)
    {
        $c = $docroot . '/wp-config.php';
        if (is_file($c)) {
            return $c;
        }
        $up = dirname($docroot);
        if ($up !== $docroot && $up !== '' && is_file($up . '/wp-config.php') && !is_file($up . '/wp-settings.php')) {
            return $up . '/wp-config.php';
        }
        return null;
    }

    /**
     * Parse constants and $table_prefix without executing the file. Handles any spacing and
     * quote style in define(...), comments, and one level of relative include/require.
     * Returns array('constants' => [...], 'table_prefix' => string|null, 'file' => path).
     */
    public static function parse($file)
    {
        $out = array('constants' => array(), 'table_prefix' => null, 'file' => $file, 'includes' => array());
        $src = @file_get_contents($file, false, null, 0, 524288);
        if (!is_string($src)) {
            return $out;
        }
        $main = self::parseSource($src);
        $out['constants'] = $main['constants'];
        $out['table_prefix'] = $main['table_prefix'];
        $dir = dirname($file);
        $seen = 0;
        foreach ($main['includes'] as $inc) {
            $rel = $inc['path'];
            // "__DIR__ . '/x.php'" and "dirname(__FILE__) . '/x.php'" leave a leading slash on a
            // path that is relative to the config dir, so relative candidates come first.
            $cands = array($dir . '/' . ltrim($rel, '/'), $dir . '/../' . ltrim($rel, '/'));
            if ($rel !== '' && $rel[0] === '/') {
                $cands[] = $rel;
            }
            foreach ($cands as $c) {
                if (!is_file($c) || realpath($c) === realpath($file)) {
                    continue;
                }
                $s2 = @file_get_contents($c, false, null, 0, 524288);
                if (!is_string($s2)) {
                    continue;
                }
                $sub = self::parseSource($s2);
                $out['includes'][] = $c;
                foreach ($sub['constants'] as $k => $v) {
                    // An include placed before a define in the main file wins (PHP keeps the first define).
                    if (!isset($out['constants'][$k]) || (isset($main['positions'][$k]) && $inc['pos'] < $main['positions'][$k])) {
                        $out['constants'][$k] = $v;
                    }
                }
                if ($out['table_prefix'] === null && $sub['table_prefix'] !== null) {
                    $out['table_prefix'] = $sub['table_prefix'];
                }
                break;
            }
            if (++$seen >= 6) {
                break;
            }
        }
        return $out;
    }

    private static function parseSource($src)
    {
        $res = array('constants' => array(), 'positions' => array(), 'table_prefix' => null, 'includes' => array());
        if (function_exists('token_get_all')) {
            $tokens = @token_get_all($src);
            if (is_array($tokens)) {
                self::parseTokens($tokens, $res);
                return $res;
            }
        }
        // Fallback: regex on a comment-stripped copy.
        $clean = preg_replace('~/\*.*?\*/~s', '', $src);
        $clean = preg_replace('~^\s*(//|#).*$~m', '', $clean);
        $re = '/\bdefine\s*\(\s*([\'"])([A-Za-z0-9_]+)\1\s*,\s*(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*"|true|false|TRUE|FALSE|-?\d+)\s*\)/';
        if (preg_match_all($re, $clean, $mm, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            foreach ($mm as $m) {
                $k = $m[2][0];
                if (isset($res['constants'][$k])) {
                    continue;
                }
                $res['constants'][$k] = self::literal($m[3][0]);
                $res['positions'][$k] = $m[0][1];
            }
        }
        if (preg_match('/\$table_prefix\s*=\s*(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")\s*;/', $clean, $m)) {
            $res['table_prefix'] = self::literal($m[1]);
        }
        if (preg_match_all('/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*|dirname\s*\(\s*__FILE__\s*\)\s*\.\s*|ABSPATH\s*\.\s*)?([\'"])([^\'"\r\n]+\.php)\1/', $clean, $mm, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            foreach ($mm as $m) {
                $res['includes'][] = array('path' => $m[2][0], 'pos' => $m[0][1]);
            }
        }
        return $res;
    }

    private static function parseTokens($tokens, &$res)
    {
        $n = count($tokens);
        $pos = 0;
        $sig = array(); // significant tokens: array(kind, text, offset)
        foreach ($tokens as $t) {
            if (is_array($t)) {
                $id = $t[0];
                $text = $t[1];
                $pos += strlen($text);
                if ($id === T_WHITESPACE || $id === T_COMMENT || $id === T_DOC_COMMENT || $id === T_OPEN_TAG || $id === T_INLINE_HTML) {
                    continue;
                }
                $sig[] = array($id, $text, $pos);
            } else {
                $pos += strlen($t);
                $sig[] = array(0, $t, $pos);
            }
        }
        $n = count($sig);
        for ($i = 0; $i < $n; $i++) {
            list($id, $text) = $sig[$i];
            // define ( 'NAME' , <value> )
            if ($id === T_STRING && strtolower($text) === 'define' && $i + 5 < $n && $sig[$i + 1][1] === '(' && $sig[$i + 2][0] === T_CONSTANT_ENCAPSED_STRING && $sig[$i + 3][1] === ',') {
                $name = self::literal($sig[$i + 2][1]);
                $v = $sig[$i + 4];
                $val = null;
                if ($v[0] === T_CONSTANT_ENCAPSED_STRING) {
                    $val = self::literal($v[1]);
                } elseif ($v[0] === T_STRING) {
                    $l = strtolower($v[1]);
                    if ($l === 'true' || $l === 'false') {
                        $val = ($l === 'true');
                    } elseif ($l === 'null') {
                        $val = null;
                    }
                } elseif ($v[0] === T_LNUMBER || $v[0] === T_DNUMBER) {
                    $val = $v[1] + 0;
                } elseif ($v[1] === '-' && isset($sig[$i + 5]) && $sig[$i + 5][0] === T_LNUMBER) {
                    $val = -($sig[$i + 5][1] + 0);
                }
                if ($val !== null && $name !== '' && !isset($res['constants'][$name])) {
                    $res['constants'][$name] = $val;
                    $res['positions'][$name] = $sig[$i][2];
                }
                continue;
            }
            // $table_prefix = 'wp_';
            if ($id === T_VARIABLE && $text === '$table_prefix' && $i + 2 < $n && $sig[$i + 1][1] === '=' && $sig[$i + 2][0] === T_CONSTANT_ENCAPSED_STRING) {
                if ($res['table_prefix'] === null) {
                    $res['table_prefix'] = self::literal($sig[$i + 2][1]);
                }
                continue;
            }
            // require/include [(] [__DIR__ .|dirname(__FILE__) .|ABSPATH .] 'file.php'
            if ($id === T_REQUIRE || $id === T_REQUIRE_ONCE || $id === T_INCLUDE || $id === T_INCLUDE_ONCE) {
                $j = $i + 1;
                if ($j < $n && $sig[$j][1] === '(') {
                    $j++;
                }
                // skip a leading directory expression up to the concatenation dot
                $k = $j;
                while ($k < $n && $k < $j + 6 && $sig[$k][0] !== T_CONSTANT_ENCAPSED_STRING && $sig[$k][1] !== ';') {
                    $k++;
                }
                if ($k < $n && $sig[$k][0] === T_CONSTANT_ENCAPSED_STRING) {
                    $p = self::literal($sig[$k][1]);
                    if (substr($p, -4) === '.php') {
                        $res['includes'][] = array('path' => $p, 'pos' => $sig[$i][2]);
                    }
                }
            }
        }
    }

    /** Decode a PHP string literal (with its quotes). */
    public static function literal($lit)
    {
        $lit = trim($lit);
        if ($lit === '') {
            return '';
        }
        $q = $lit[0];
        if ($q !== "'" && $q !== '"') {
            return $lit;
        }
        $body = substr($lit, 1, -1);
        if ($q === "'") {
            return preg_replace('/\\\\([\\\\\'])/', '$1', $body);
        }
        return stripcslashes($body);
    }

    /** DB_HOST -> array(host, port|null, socket|null), like wpdb::parse_db_host. */
    public static function parseHost($h)
    {
        $h = trim((string) $h);
        if ($h === '') {
            return array('localhost', null, null);
        }
        if ($h[0] === '[') {
            if (preg_match('/^\[([^\]]+)\](?::(\d+))?$/', $h, $m)) {
                return array($m[1], isset($m[2]) ? (int) $m[2] : null, null);
            }
            return array($h, null, null);
        }
        $c = substr_count($h, ':');
        if ($c === 1) {
            list($a, $b) = explode(':', $h, 2);
            if ($b !== '' && $b[0] === '/') {
                return array($a === '' ? 'localhost' : $a, null, $b);
            }
            if ($b !== '' && ctype_digit($b)) {
                return array($a === '' ? 'localhost' : $a, (int) $b, null);
            }
            return array($h, null, null);
        }
        if ($c > 1 && preg_match('/^(.*):(\/[^:]*)$/', $h, $m)) {
            return array($m[1] === '' ? 'localhost' : $m[1], null, $m[2]);
        }
        return array($h, null, null);
    }

    public static function mysqliAvailable()
    {
        return class_exists('mysqli') && function_exists('mysqli_init');
    }

    /** host/port/socket that actually worked in the last successful connect(). */
    public static $resolved = null;

    /** Socket paths worth trying when PHP's default socket is not the server's. */
    public static function candidateSockets()
    {
        $list = array();
        $cands = array(@ini_get('mysqli.default_socket'), @ini_get('pdo_mysql.default_socket'),
            '/var/run/mysqld/mysqld.sock', '/run/mysqld/mysqld.sock', '/var/lib/mysql/mysql.sock',
            '/tmp/mysql.sock', '/var/run/mysql/mysql.sock', '/var/mysql/mysql.sock',
            '/opt/lampp/var/mysql/mysql.sock', '/usr/local/mysql/mysql.sock', '/var/run/mysqld/mysql.sock');
        foreach ($cands as $s) {
            if (is_string($s) && $s !== '' && !in_array($s, $list, true) && @file_exists($s)) {
                $list[] = $s;
            }
        }
        return $list;
    }

    /**
     * Connect; returns mysqli or null with $err set (never includes the password).
     * For DB_HOST "localhost" without an explicit socket, PHP's compiled-in socket path is often
     * not the server's (seen on Enhance nodes), so on error 2002 the usual socket locations and
     * then TCP 127.0.0.1 are tried. Authentication errors are never retried.
     */
    public static function connect($creds, &$err)
    {
        $err = '';
        if (!self::mysqliAvailable()) {
            $err = 'the PHP mysqli extension is not available on this host';
            return null;
        }
        if (function_exists('mysqli_report')) {
            @mysqli_report(MYSQLI_REPORT_OFF);
        }
        list($host, $port, $socket) = self::parseHost($creds['host']);
        if ($port === null) {
            $port = (int) @ini_get('mysqli.default_port');
            if ($port <= 0) {
                $port = 3306;
            }
        }
        $attempts = array(array($host, $port, $socket));
        if ($socket === null && ($host === 'localhost' || $host === '')) {
            foreach (self::candidateSockets() as $s) {
                $attempts[] = array('localhost', $port, $s);
            }
            $attempts[] = array('127.0.0.1', $port, null);
        }
        $last = '';
        foreach ($attempts as $a) {
            $m = @mysqli_init();
            if (!$m) {
                $err = 'mysqli_init failed';
                return null;
            }
            @$m->options(MYSQLI_OPT_CONNECT_TIMEOUT, 8);
            $ok = @$m->real_connect($a[0], (string) $creds['user'], (string) $creds['pass'], (string) $creds['name'], (int) $a[1], $a[2]);
            if ($ok) {
                self::$resolved = $a;
                if (!@$m->set_charset('utf8mb4')) {
                    @$m->set_charset('utf8');
                }
                @$m->query("SET SESSION sql_mode=''");
                @$m->query("SET time_zone='+00:00'");
                return $m;
            }
            $errno = (int) $m->connect_errno;
            $last = '(' . $errno . ') ' . $m->connect_error;
            if ($errno !== 2002 && $errno !== 2003 && $errno !== 2005) {
                break; // wrong credentials or a server-side refusal: do not hammer the server
            }
        }
        $err = 'database connection failed: ' . $last;
        return null;
    }

    /** Tables and views of a database: list of array(name, type 'table'|'view', rows, bytes). */
    public static function listTables($m, $db)
    {
        $list = array();
        $sql = "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH AS B FROM information_schema.TABLES WHERE TABLE_SCHEMA='" . $m->real_escape_string($db) . "' ORDER BY TABLE_NAME";
        $r = @$m->query($sql);
        if ($r) {
            while ($row = $r->fetch_row()) {
                $t = (stripos((string) $row[1], 'VIEW') !== false) ? 'view' : 'table';
                $list[] = array('name' => $row[0], 'type' => $t, 'rows' => (int) $row[2], 'bytes' => (int) $row[3]);
            }
            $r->free();
        }
        if (!$list) {
            $r = @$m->query('SHOW FULL TABLES');
            if ($r) {
                while ($row = $r->fetch_row()) {
                    $t = (stripos((string) $row[1], 'VIEW') !== false) ? 'view' : 'table';
                    $list[] = array('name' => $row[0], 'type' => $t, 'rows' => 0, 'bytes' => 0);
                }
                $r->free();
            }
        }
        // tables first, views last (views depend on tables)
        usort($list, function ($a, $b) {
            if ($a['type'] !== $b['type']) {
                return $a['type'] === 'table' ? -1 : 1;
            }
            return strcmp($a['name'], $b['name']);
        });
        return $list;
    }
}

/* ------------------------------------------------------------------------------------------
 * Output writer (plain or gzip member per call), tar writer, directory walker
 * ---------------------------------------------------------------------------------------- */

final class MigOutput
{
    private $fh = null;
    private $ctx = null;
    private $buf = '';
    public $gz = false;
    public $path;

    public static function gzAvailable()
    {
        return function_exists('deflate_init') && function_exists('deflate_add') && defined('ZLIB_ENCODING_GZIP');
    }

    /** Open for append; when $truncateTo is given, first cut the file back to that size. */
    public function __construct($path, $gz, $truncateTo = null)
    {
        $this->path = $path;
        $this->gz = (bool) $gz;
        $this->fh = @fopen($path, 'c');
        if (!$this->fh) {
            throw new MigError('cannot open ' . basename($path) . ' for writing');
        }
        if ($truncateTo !== null) {
            @ftruncate($this->fh, (int) $truncateTo);
        }
        fseek($this->fh, 0, SEEK_END);
        if ($this->gz) {
            $this->ctx = @deflate_init(ZLIB_ENCODING_GZIP, array('level' => MIG_GZ_LEVEL));
            if ($this->ctx === false) {
                throw new MigError('deflate_init failed');
            }
        }
    }

    public function write($data)
    {
        $this->buf .= $data;
        if (strlen($this->buf) >= 1048576) {
            $this->flushBuf(false);
        }
    }

    private function flushBuf($finish)
    {
        if ($this->ctx !== null) {
            $o = @deflate_add($this->ctx, $this->buf, $finish ? ZLIB_FINISH : ZLIB_NO_FLUSH);
            if ($o === false) {
                throw new MigError('deflate_add failed');
            }
        } else {
            $o = $this->buf;
        }
        $this->buf = '';
        if ($o !== '') {
            $n = @fwrite($this->fh, $o);
            if ($n !== strlen($o)) {
                throw new MigError('write failed on ' . basename($this->path) . ' (disk full or quota exceeded?)');
            }
        }
    }

    /** Finish the current gzip member and close. Returns the file size. */
    public function close()
    {
        if ($this->fh === null) {
            return 0;
        }
        $this->flushBuf(true);
        @fflush($this->fh);
        $size = ftell($this->fh);
        @fclose($this->fh);
        $this->fh = null;
        $this->ctx = null;
        return $size;
    }

    public function abort()
    {
        if ($this->fh !== null) {
            @fclose($this->fh);
            $this->fh = null;
            $this->ctx = null;
        }
    }
}

final class MigTar
{
    private $out;

    public function __construct(MigOutput $out)
    {
        $this->out = $out;
    }

    /** Octal field of $len bytes (digits + NUL); base-256 when the value does not fit. */
    private static function num($n, $len)
    {
        $n = (int) $n;
        if ($n < 0) {
            $n = 0;
        }
        $digits = $len - 1;
        if ($n <= (int) (pow(8, $digits) - 1)) {
            return str_pad(decoct($n), $digits, '0', STR_PAD_LEFT) . "\0";
        }
        $s = '';
        for ($i = 0; $i < $len; $i++) {
            $s = chr($n & 0xff) . $s;
            $n = $n >> 8;
        }
        $s[0] = chr(ord($s[0]) | 0x80);
        return $s;
    }

    private static function block($name, $mode, $uid, $gid, $size, $mtime, $type, $linkname, $prefix)
    {
        $mtime = (int) $mtime;
        if ($mtime < 0) {
            $mtime = 0;
        }
        $h = str_pad(substr($name, 0, 100), 100, "\0")
            . self::num($mode & 07777, 8)
            . self::num(min((int) $uid, 07777777), 8)
            . self::num(min((int) $gid, 07777777), 8)
            . self::num($size, 12)
            . self::num(min($mtime, 077777777777), 12)
            . '        '
            . $type
            . str_pad(substr($linkname, 0, 100), 100, "\0")
            . "ustar\0" . '00'
            . str_repeat("\0", 32) . str_repeat("\0", 32)
            . self::num(0, 8) . self::num(0, 8)
            . str_pad(substr($prefix, 0, 155), 155, "\0")
            . str_repeat("\0", 12);
        $sum = array_sum(unpack('C*', $h));
        return substr($h, 0, 148) . sprintf('%06o', $sum) . "\0 " . substr($h, 156);
    }

    /** Split a long path into ustar prefix/name, or null when impossible. */
    private static function splitUstar($name)
    {
        $len = strlen($name);
        $lo = max($len - 101, 1);
        $hi = min(155, $len - 2);
        for ($i = $lo; $i <= $hi; $i++) {
            if ($name[$i] === '/') {
                $p = substr($name, 0, $i);
                $n = substr($name, $i + 1);
                if ($p !== '' && $n !== '') {
                    return array($p, $n);
                }
            }
        }
        return null;
    }

    private function longEntry($type, $data)
    {
        $data .= "\0";
        $this->out->write(self::block('././@LongLink', 0644, 0, 0, strlen($data), 0, $type, '', ''));
        $this->out->write(self::pad($data));
    }

    public static function pad($data)
    {
        $r = strlen($data) % 512;
        return $r ? $data . str_repeat("\0", 512 - $r) : $data;
    }

    public static function padding($size)
    {
        $r = $size % 512;
        return $r ? str_repeat("\0", 512 - $r) : '';
    }

    /** Write a header. $type: '0' file, '2' symlink, '5' directory (name must end with '/'). */
    public function header($name, $mode, $uid, $gid, $size, $mtime, $type, $linkname = '')
    {
        $prefix = '';
        if (strlen($name) > 100) {
            $split = self::splitUstar($name);
            if ($split !== null) {
                list($prefix, $name) = $split;
            } else {
                $this->longEntry('L', $name);
                $name = substr($name, 0, 100);
            }
        }
        if (strlen($linkname) > 100) {
            $this->longEntry('K', $linkname);
            $linkname = substr($linkname, 0, 100);
        }
        $this->out->write(self::block($name, $mode, $uid, $gid, $size, $mtime, $type, $linkname, $prefix));
    }

    public function data($chunk)
    {
        $this->out->write($chunk);
    }

    public function finish()
    {
        $this->out->write(str_repeat("\0", 1024));
    }
}

/**
 * Depth-first walk of the docroot with the archive exclusions. The pending-directory stack
 * is plain data so it can be stored in a state file and resumed in a later call.
 */
final class MigWalker
{
    public $docroot;
    public $stack = array('');
    private $topSkip = array();
    private $relSkip = array();

    public function __construct($docroot, $tmpName, $helperRel)
    {
        $this->docroot = $docroot;
        if ($tmpName !== '') {
            $this->topSkip[$tmpName] = true;
        }
        if ($helperRel !== '' && strpos($helperRel, '/') === false) {
            $this->topSkip[$helperRel] = true;
        } elseif ($helperRel !== '') {
            $this->relSkip[$helperRel] = true;
        }
        $this->relSkip['wp-content/plugins/mig-helper'] = true;
        $this->relSkip['wp-content/cache'] = true;
        $this->relSkip['wp-content/ai1wm-backups'] = true;
        $this->relSkip['wp-content/updraft'] = true;
    }

    /** Exclusion rules of the contract, applied to a relative path. */
    public function excluded($rel, $base, $isDir)
    {
        if (strpos($rel, '/') === false) {
            if (isset($this->topSkip[$rel]) || strncmp($rel, '.mig-tmp-', 9) === 0) {
                return true;
            }
        }
        if (isset($this->relSkip[$rel])) {
            return true;
        }
        if ($base === '.git' || $base === 'debug.log' || $base === 'error_log') {
            return true;
        }
        if ($isDir) {
            if (strncmp($rel, 'wp-content/', 11) === 0 && strpos($rel, '/', 11) === false) {
                // directly under wp-content
                if (stripos($base, 'cache') !== false || strncmp($base, 'backups-dup-', 12) === 0) {
                    return true;
                }
            }
        } elseif (substr($base, -7) === '.wpress') {
            return true;
        }
        return false;
    }

    /**
     * Process pending directories until $deadline. $emit($kind, $rel, $size, $lstat) is called
     * with kind 'dir' | 'file' | 'link' | 'special' | 'unreadable'. Returns true when finished.
     */
    public function step($deadline, $emit)
    {
        $first = true;
        while ($this->stack) {
            if (!$first && microtime(true) > $deadline) {
                return false;
            }
            $first = false;
            $rel = array_pop($this->stack);
            $abs = ($rel === '') ? $this->docroot : $this->docroot . '/' . $rel;
            $entries = @scandir($abs, SCANDIR_SORT_ASCENDING);
            if ($entries === false) {
                $emit('unreadable', $rel, 0, null);
                continue;
            }
            $dirs = array();
            foreach ($entries as $e) {
                if ($e === '.' || $e === '..') {
                    continue;
                }
                $r = ($rel === '') ? $e : $rel . '/' . $e;
                $st = @lstat($abs . '/' . $e);
                if ($st === false) {
                    continue;
                }
                $fmt = $st['mode'] & 0170000;
                $isLink = ($fmt === 0120000);
                $isDir = ($fmt === 0040000);
                if ($this->excluded($r, $e, $isDir)) {
                    continue;
                }
                if ($isDir) {
                    $dirs[] = $r;
                    $emit('dir', $r, 0, $st);
                } elseif ($isLink) {
                    $emit('link', $r, 0, $st);
                } elseif ($fmt === 0100000) {
                    $emit('file', $r, (int) $st['size'], $st);
                } else {
                    $emit('special', $r, 0, $st);
                }
            }
            for ($i = count($dirs) - 1; $i >= 0; $i--) {
                $this->stack[] = $dirs[$i];
            }
        }
        return true;
    }
}

/* ------------------------------------------------------------------------------------------
 * The agent: request context, temp dir, state files, actions
 * ---------------------------------------------------------------------------------------- */

final class MigAgent
{
    public static $responded = false;

    public $docroot;
    public $tmp;
    public $tmpName;
    public $plugin = false;
    public $cli = false;
    public $params = array();
    public $start;
    public $budget;
    public $deadline;
    public $helperRel = '';
    private $lockFh = null;
    private $wp = null;
    public $hostMemoryLimit = '';

    public function __construct($docroot, $params, $opts = array())
    {
        $this->start = microtime(true);
        $this->plugin = !empty($opts['plugin']);
        $this->cli = !empty($opts['cli']);
        $this->params = is_array($params) ? $params : array();

        $d = (string) $docroot;
        if (DIRECTORY_SEPARATOR === '\\') {
            $d = str_replace('\\', '/', $d); // Windows only: a backslash is a legal name character on Unix
        }
        $d = rtrim($d, '/');
        if ($d === '') {
            $d = '/';
        }
        $real = @realpath($d);
        if ($real !== false) {
            $d = rtrim(DIRECTORY_SEPARATOR === '\\' ? str_replace('\\', '/', $real) : $real, '/');
            if ($d === '') {
                $d = '/';
            }
        }
        if (!is_dir($d)) {
            throw new MigError('docroot not found: ' . $d);
        }
        $this->docroot = $d;

        $self = @realpath(__FILE__);
        if ($self !== false && strpos($self, $d . '/') === 0) {
            $this->helperRel = substr($self, strlen($d) + 1);
        }

        $ov = isset($opts['tmp']) ? rtrim((string) $opts['tmp'], '/') : '';
        if ($ov !== '') {
            $this->tmp = $ov;
            $this->tmpName = basename($ov);
        } else {
            $this->tmpName = '.mig-tmp-' . substr(hash('sha256', 'mig|' . MIG_CFG_TOKEN . '|' . $d), 0, 8);
            $this->tmp = $d . '/' . $this->tmpName;
        }

        $this->budget = MIG_CALL_BUDGET;
        if (!$this->cli) {
            $max = (int) @ini_get('max_execution_time');
            if (!@set_time_limit(0) && $max > 0 && $max < 30) {
                $this->budget = max(5, min(MIG_CALL_BUDGET, $max - 8));
            }
        }
        if ($this->cli && is_numeric(getenv('MIG_BUDGET'))) {
            $this->budget = (float) getenv('MIG_BUDGET'); // tests only: force short calls
        }
        $this->deadline = $this->start + $this->budget;
        $this->hostMemoryLimit = (string) @ini_get('memory_limit');
        @ini_set('memory_limit', '256M'); // may be refused; the code works within 128M anyway
    }

    /** String parameter (GET/POST/CLI); empty or missing -> $default. */
    public function param($k, $default = '')
    {
        if (isset($this->params[$k]) && is_string($this->params[$k]) && $this->params[$k] !== '') {
            return $this->params[$k];
        }
        return $default;
    }

    public function elapsed()
    {
        return microtime(true) - $this->start;
    }

    public function overBudget()
    {
        return microtime(true) >= $this->deadline;
    }

    public function ensureTmp()
    {
        if (!is_dir($this->tmp)) {
            if (!@mkdir($this->tmp, 0755, true) && !is_dir($this->tmp)) {
                throw new MigError('cannot create temp dir ' . $this->tmp . ' (permissions?)');
            }
        }
        $ht = $this->tmp . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder deny,allow\nDeny from all\n</IfModule>\n");
        }
        $ix = $this->tmp . '/index.html';
        if (!is_file($ix)) {
            @file_put_contents($ix, '');
        }
        return $this->tmp;
    }

    public function stateRead($name)
    {
        $f = $this->tmp . '/' . $name;
        clearstatcache(true, $f);
        if (!is_file($f)) {
            return null;
        }
        $j = @file_get_contents($f);
        $d = is_string($j) ? @json_decode($j, true) : null;
        return is_array($d) ? $d : null;
    }

    public function stateWrite($name, $data)
    {
        $f = $this->tmp . '/' . $name;
        $t = $f . '.' . getmypid() . '.tmp';
        if (@file_put_contents($t, MigUtil::jsonEncode($data)) === false || !@rename($t, $f)) {
            @unlink($t);
            throw new MigError('cannot write state file ' . $name);
        }
    }

    public function stateDelete($name)
    {
        @unlink($this->tmp . '/' . $name);
    }

    public function lock($name)
    {
        $h = @fopen($this->tmp . '/' . $name . '.lock', 'c');
        if (!$h) {
            return true; // cannot lock on this host: proceed
        }
        if (!@flock($h, LOCK_EX | LOCK_NB)) {
            @fclose($h);
            return false;
        }
        $this->lockFh = $h;
        return true;
    }

    public function unlock()
    {
        if ($this->lockFh) {
            @flock($this->lockFh, LOCK_UN);
            @fclose($this->lockFh);
            $this->lockFh = null;
        }
    }

    /** Notes list helper: keep the first 50 and count the rest. */
    public static function note(&$st, $msg)
    {
        if (!isset($st['notes'])) {
            $st['notes'] = array();
        }
        if (count($st['notes']) < 50) {
            $st['notes'][] = $msg;
        }
        $st['notes_count'] = isset($st['notes_count']) ? $st['notes_count'] + 1 : 1;
    }

    /* ---------------------------------------------------------------- WordPress facts */

    public function wp()
    {
        if ($this->wp !== null) {
            return $this->wp;
        }
        $this->wp = array('is' => false, 'config' => null, 'constants' => array(), 'table_prefix' => null, 'multisite' => false, 'version' => null);
        $cfg = MigWp::findConfig($this->docroot);
        $core = is_file($this->docroot . '/wp-includes/version.php') || is_file($this->docroot . '/wp-settings.php');
        if ($cfg === null && !$core) {
            return $this->wp;
        }
        $this->wp['is'] = true;
        $this->wp['config'] = $cfg;
        if ($cfg !== null) {
            $p = MigWp::parse($cfg);
            $this->wp['constants'] = $p['constants'];
            $this->wp['table_prefix'] = ($p['table_prefix'] !== null && $p['table_prefix'] !== '') ? $p['table_prefix'] : 'wp_';
            $this->wp['multisite'] = !empty($p['constants']['MULTISITE']);
        } else {
            $this->wp['table_prefix'] = 'wp_';
        }
        $v = @file_get_contents($this->docroot . '/wp-includes/version.php', false, null, 0, 8192);
        if (is_string($v) && preg_match('/\$wp_version\s*=\s*[\'"]([^\'"]+)[\'"]/', $v, $m)) {
            $this->wp['version'] = $m[1];
        }
        return $this->wp;
    }

    /** DB credentials: request overrides, then wp-config.php. null when unknown. */
    public function dbCreds()
    {
        $wp = $this->wp();
        $c = $wp['constants'];
        $creds = array(
            'host' => $this->param('db_host', isset($c['DB_HOST']) ? (string) $c['DB_HOST'] : 'localhost'),
            'user' => $this->param('db_user', isset($c['DB_USER']) ? (string) $c['DB_USER'] : ''),
            'pass' => $this->param('db_pass', isset($c['DB_PASSWORD']) ? (string) $c['DB_PASSWORD'] : ''),
            'name' => $this->param('db_name', isset($c['DB_NAME']) ? (string) $c['DB_NAME'] : ''),
        );
        if ($creds['name'] === '' || $creds['user'] === '') {
            return null;
        }
        return $creds;
    }

    public function walker()
    {
        return new MigWalker($this->docroot, $this->tmpName, $this->helperRel);
    }

    /* ---------------------------------------------------------------- info */

    public function actionInfo()
    {
        $this->ensureTmp();
        $wp = $this->wp();
        $r = array(
            'ok' => true,
            'agent_version' => MIG_AGENT_VERSION,
            'agent_mode' => $this->plugin ? 'plugin' : ($this->cli ? 'cli' : 'file'),
            'php_version' => PHP_VERSION,
            'exec' => MigUtil::execAvailable(),
            'mysqli' => MigWp::mysqliAvailable(),
            'zlib' => MigOutput::gzAvailable(),
            'wordpress' => $wp['is'],
            'wp_version' => $wp['version'],
            'table_prefix' => $wp['is'] ? $wp['table_prefix'] : null,
            'multisite' => $wp['multisite'],
            'site_url' => null,
            'docroot' => $this->docroot,
            'tmp_dir' => $this->tmp,
            'tmp_dir_name' => $this->tmpName,
            'disk_free' => null,
            'max_execution_time' => (int) @ini_get('max_execution_time'),
            'memory_limit' => $this->hostMemoryLimit,
            'files' => array('count' => 0, 'bytes' => 0, 'partial' => false),
            'plugins' => array('active' => array(), 'litespeed_cache' => false, 'wp_rocket' => false, 'object_cache' => false),
        );
        $free = @disk_free_space($this->docroot);
        if ($free !== false) {
            $r['disk_free'] = (int) $free;
        }
        if (MigUtil::execAvailable()) {
            $r['exec_tools'] = array(
                'mysqldump' => MigUtil::haveBinary('mysqldump') !== '' || MigUtil::haveBinary('mariadb-dump') !== '',
                'tar' => MigUtil::haveBinary('tar') !== '',
                'gzip' => MigUtil::haveBinary('gzip') !== '',
                'split' => MigUtil::haveBinary('split') !== '',
            );
        }

        if ($wp['is']) {
            $c = $wp['constants'];
            $creds = $this->dbCreds();
            if ($creds !== null) {
                $r['db'] = array('name' => $creds['name'], 'user' => $creds['user'], 'host' => $creds['host']);
                $err = '';
                $m = MigWp::connect($creds, $err);
                if ($m) {
                    $this->wpFactsFromDb($m, $wp['table_prefix'], $wp['multisite'], $r);
                    @$m->close();
                } else {
                    $r['db_error'] = $err;
                }
            } else {
                $r['db_error'] = 'DB_NAME/DB_USER not found in wp-config.php';
            }
            if ($r['site_url'] === null) {
                foreach (array('WP_SITEURL', 'WP_HOME') as $k) {
                    if (!empty($c[$k]) && is_string($c[$k])) {
                        $r['site_url'] = $c[$k];
                        break;
                    }
                }
            }
            $r['plugins']['object_cache'] = is_file($this->docroot . '/wp-content/object-cache.php');
        }
        if ($r['site_url'] === null && !$this->cli && !empty($_SERVER['HTTP_HOST'])) {
            $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443);
            $r['site_url'] = ($https ? 'https://' : 'http://') . preg_replace('/[^A-Za-z0-9.:\[\]-]/', '', $_SERVER['HTTP_HOST']);
        }

        // File walk with its own budget (15 s), independent of the call budget.
        $count = 0;
        $bytes = 0;
        $w = $this->walker();
        $done = $w->step(microtime(true) + MIG_INFO_WALK_BUDGET, function ($kind, $rel, $size) use (&$count, &$bytes) {
            if ($kind === 'file') {
                $count++;
                $bytes += $size;
            }
        });
        $r['files'] = array('count' => $count, 'bytes' => $bytes, 'partial' => !$done);
        return $r;
    }

    private function wpFactsFromDb($m, $prefix, $multisite, &$r)
    {
        $opt = MigUtil::backtick($prefix . 'options');
        $res = @$m->query("SELECT option_name, option_value FROM $opt WHERE option_name IN ('siteurl','home','active_plugins')");
        $active = array();
        if ($res) {
            while ($row = $res->fetch_row()) {
                if ($row[0] === 'siteurl') {
                    $r['site_url'] = $row[1];
                } elseif ($row[0] === 'home' && $r['site_url'] === null) {
                    $r['site_url'] = $row[1];
                } elseif ($row[0] === 'active_plugins') {
                    $a = @unserialize((string) $row[1], array('allowed_classes' => false));
                    if (is_array($a)) {
                        foreach ($a as $p) {
                            if (is_string($p)) {
                                $active[$p] = true;
                            }
                        }
                    }
                }
            }
            $res->free();
        }
        if ($multisite) {
            $meta = MigUtil::backtick($prefix . 'sitemeta');
            $res = @$m->query("SELECT meta_value FROM $meta WHERE meta_key='active_sitewide_plugins' LIMIT 1");
            if ($res) {
                if ($row = $res->fetch_row()) {
                    $a = @unserialize((string) $row[0], array('allowed_classes' => false));
                    if (is_array($a)) {
                        foreach (array_keys($a) as $p) {
                            if (is_string($p)) {
                                $active[$p] = true;
                            }
                        }
                    }
                }
                $res->free();
            }
        }
        $list = array_keys($active);
        sort($list);
        $r['plugins']['active'] = $list;
        $r['plugins']['litespeed_cache'] = isset($active['litespeed-cache/litespeed-cache.php']);
        $r['plugins']['wp_rocket'] = isset($active['wp-rocket/wp-rocket.php']);
        $r['db_size'] = 0;
        $r['db_tables'] = 0;
        foreach (MigWp::listTables($m, $r['db']['name']) as $t) {
            $r['db_size'] += $t['bytes'];
            $r['db_tables']++;
        }
    }

    /* ---------------------------------------------------------------- get */

    public function actionGet()
    {
        $name = $this->param('file');
        if ($name === '' || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/', $name) || strpos($name, '..') !== false) {
            throw new MigError('file not found', 404);
        }
        $real = @realpath($this->tmp . '/' . $name);
        $tmpReal = @realpath($this->tmp);
        if ($real === false || $tmpReal === false || dirname($real) !== $tmpReal || !is_file($real) || is_link($this->tmp . '/' . $name)) {
            throw new MigError('file not found', 404);
        }
        clearstatcache(true, $real);
        $size = (int) filesize($real);
        $start = 0;
        $end = $size - 1;
        $partial = false;
        $range = $this->cli ? $this->param('range') : (isset($_SERVER['HTTP_RANGE']) ? (string) $_SERVER['HTTP_RANGE'] : '');
        if ($range !== '') {
            $bad = true;
            if (preg_match('/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i', $range, $m) && ($m[1] !== '' || $m[2] !== '')) {
                if ($m[1] === '') {
                    $n = (int) $m[2];
                    if ($n > 0 && $size > 0) {
                        $start = max(0, $size - $n);
                        $end = $size - 1;
                        $bad = false;
                    }
                } else {
                    $start = (int) $m[1];
                    $end = ($m[2] === '') ? $size - 1 : min((int) $m[2], $size - 1);
                    if ($start < $size && $start <= $end) {
                        $bad = false;
                    }
                }
            }
            if ($bad) {
                throw new MigError('range not satisfiable', 416, array('size' => $size));
            }
            $partial = true;
        }
        $len = ($size === 0) ? 0 : ($end - $start + 1);

        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        self::$responded = true;
        @ini_set('zlib.output_compression', '0');
        @set_time_limit(0);
        ignore_user_abort(false);
        if (!$this->cli) {
            http_response_code($partial ? 206 : 200);
            header('Content-Type: application/octet-stream');
            header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
            header('Pragma: no-cache');
            header('Accept-Ranges: bytes');
            header('Content-Length: ' . $len);
            if ($partial) {
                header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
            }
            header('Content-Disposition: attachment; filename="' . $name . '"');
            header('X-Accel-Buffering: no');
            header('X-Content-Type-Options: nosniff');
            if (function_exists('apache_setenv')) {
                @apache_setenv('no-gzip', '1');
                @apache_setenv('dont-vary', '1');
            }
            if (isset($_SERVER['REQUEST_METHOD']) && strtoupper($_SERVER['REQUEST_METHOD']) === 'HEAD') {
                exit;
            }
        }
        if ($len > 0) {
            $fh = @fopen($real, 'rb');
            if (!$fh) {
                exit;
            }
            if ($start > 0) {
                fseek($fh, $start);
            }
            $left = $len;
            while ($left > 0) {
                $chunk = fread($fh, (int) min(262144, $left));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                $left -= strlen($chunk);
                flush();
                if (!$this->cli && connection_aborted()) {
                    break;
                }
            }
            fclose($fh);
        }
        exit;
    }

    /* ---------------------------------------------------------------- cleanup */

    public function actionCleanup()
    {
        $r = array('ok' => true);
        foreach (array('dump.state.json', 'archive.state.json') as $s) {
            $st = $this->stateRead($s);
            if ($st && !empty($st['pid'])) {
                MigUtil::kill($st['pid']);
            }
        }
        if (MigUtil::execAvailable() && MigUtil::haveBinary('pkill') !== '') {
            MigUtil::run('pkill -f ' . escapeshellarg($this->tmp . '/'), 5);
        }
        if (is_dir($this->tmp)) {
            $r['tmp_removed'] = MigUtil::rmTree($this->tmp);
        } else {
            $r['tmp_removed'] = true;
        }
        if ($this->plugin) {
            if (function_exists('mig_helper_self_destruct')) {
                $r['plugin_removed'] = (bool) mig_helper_self_destruct();
            }
        } elseif (!$this->cli || $this->param('self_delete') === '1') {
            $r['helper_removed'] = @unlink(__FILE__) || !file_exists(__FILE__);
        }
        return $r;
    }

    /* ---------------------------------------------------------------- dump */

    public function actionDump()
    {
        $this->ensureTmp();
        $st = $this->stateRead('dump.state.json');
        if ($st === null || $this->param('restart') === '1') {
            if ($st !== null) {
                $this->dumpDiscard($st);
            }
            $st = $this->dumpStart();
        }
        if (!empty($st['done'])) {
            return $this->dumpDone($st);
        }
        if (!empty($st['error'])) {
            return array('ok' => false, 'error' => $st['error'], 'mode' => $st['mode']);
        }
        if ($st['mode'] === 'exec') {
            $st = $this->dumpPollExec($st);
        } else {
            $st = $this->dumpWorkMysqli($st);
        }
        $this->stateWrite('dump.state.json', $st);
        if (!empty($st['done'])) {
            return $this->dumpDone($st);
        }
        if (!empty($st['error'])) {
            return array('ok' => false, 'error' => $st['error'], 'mode' => $st['mode']);
        }
        return array('ok' => true, 'done' => false, 'mode' => $st['mode'], 'progress' => $this->dumpProgress($st));
    }

    private function dumpProgress($st)
    {
        return array(
            'tables_done' => (int) $st['tables_done'],
            'tables_total' => $st['tables_total'],
            'rows' => (int) $st['rows'],
            'bytes' => isset($st['bytes']) ? (int) $st['bytes'] : 0,
            'elapsed' => time() - (int) $st['started'],
        );
    }

    private function dumpDone($st)
    {
        $f = $this->tmp . '/' . $st['file'];
        clearstatcache(true, $f);
        return array(
            'ok' => true,
            'done' => true,
            'mode' => $st['mode'],
            'file' => $st['file'],
            'size' => (int) @filesize($f),
            'tables' => (int) $st['tables_total'],
            'views' => (int) $st['views_total'],
            'rows' => (int) $st['rows'],
            'notes' => isset($st['notes']) ? $st['notes'] : array(),
            'elapsed' => (isset($st['finished']) ? (int) $st['finished'] : time()) - (int) $st['started'],
        );
    }

    private function dumpDiscard($st)
    {
        if (!empty($st['pid'])) {
            MigUtil::kill($st['pid']);
        }
        foreach (array('db.sql', 'db.sql.gz', 'db.out.part', 'dump.err', 'dump.exit', 'dump.fin', 'dump.pid', 'dump.sh', 'dump.sed', '.dump.cnf', 'dump.state.json') as $f) {
            @unlink($this->tmp . '/' . $f);
        }
    }

    private function dumpStart()
    {
        $creds = $this->dbCreds();
        if ($creds === null) {
            throw new MigError('database credentials not found: no DB_NAME/DB_USER in wp-config.php and no db_name/db_user parameters');
        }
        $tables = null;
        $connErr = '';
        if (MigWp::mysqliAvailable()) {
            $m = MigWp::connect($creds, $connErr);
            if ($m) {
                $tables = MigWp::listTables($m, $creds['name']);
                @$m->close();
            }
        }
        $useExec = MigUtil::execAvailable() && (MigUtil::haveBinary('mysqldump') !== '' || MigUtil::haveBinary('mariadb-dump') !== '');
        if (!$useExec) {
            if (!MigWp::mysqliAvailable()) {
                throw new MigError('cannot dump the database: no shell access to mysqldump and the PHP mysqli extension is missing');
            }
            if ($tables === null) {
                throw new MigError($connErr !== '' ? $connErr : 'database connection failed');
            }
        }
        $st = array(
            'mode' => $useExec ? 'exec' : 'mysqli',
            'started' => time(),
            'db' => $creds['name'],
            'tables' => array(),
            'tables_total' => 0,
            'views_total' => 0,
            'tables_done' => 0,
            'rows' => 0,
            'bytes' => 0,
            'done' => false,
            'error' => '',
            'notes' => array(),
        );
        if ($tables !== null) {
            foreach ($tables as $t) {
                $st['tables'][] = array('n' => $t['name'], 't' => $t['type'], 'r' => $t['rows'], 'b' => $t['bytes']);
                if ($t['type'] === 'table') {
                    $st['tables_total']++;
                } else {
                    $st['views_total']++;
                }
            }
        } else {
            $st['tables_total'] = null;
            if ($connErr !== '') {
                self::note($st, 'table list unavailable: ' . $connErr);
            }
        }
        if ($useExec) {
            $st = $this->dumpStartExec($st, $creds);
        } else {
            $st = $this->dumpStartMysqli($st);
        }
        $this->stateWrite('dump.state.json', $st);
        return $st;
    }

    private static function cnfQuote($v)
    {
        return '"' . addcslashes((string) $v, "\"\\") . '"';
    }

    private function dumpStartExec($st, $creds)
    {
        $bin = MigUtil::haveBinary('mysqldump');
        if ($bin === '') {
            $bin = MigUtil::haveBinary('mariadb-dump');
        }
        $gz = MigUtil::haveBinary('gzip') !== '';
        $st['gz'] = $gz;
        $st['file'] = $gz ? 'db.sql.gz' : 'db.sql';
        $st['tool'] = basename($bin);

        list($host, $port, $socket) = MigWp::parseHost($creds['host']);
        if (is_array(MigWp::$resolved) && $socket === null && ($host === 'localhost' || $host === '')) {
            // the PHP probe only reached the server through a specific socket or TCP: reuse it
            list($host, $port, $socket) = MigWp::$resolved;
        }
        $cnf = "[client]\nuser=" . self::cnfQuote($creds['user']) . "\npassword=" . self::cnfQuote($creds['pass']) . "\n";
        if ($socket !== null) {
            $cnf .= 'socket=' . self::cnfQuote($socket) . "\n";
        } else {
            $cnf .= 'host=' . self::cnfQuote($host) . "\n";
            if ($port !== null) {
                $cnf .= 'port=' . (int) $port . "\n";
            }
        }
        $cnfPath = $this->tmp . '/.dump.cnf';
        @unlink($cnfPath);
        if (@file_put_contents($cnfPath, $cnf) === false) {
            throw new MigError('cannot write the credentials file in the temp dir');
        }
        @chmod($cnfPath, 0600);
        // MariaDB 11.4 dumps start with "/*!999999\- enable the sandbox mode */" which older
        // mysql clients reject; drop that first line when sed is available.
        @file_put_contents($this->tmp . '/dump.sed', "1{/^\\/\\*M*!999999/d;}\n");

        $sh = "#!/bin/sh\n"
            . 'cd ' . escapeshellarg($this->tmp) . " || exit 1\n"
            . "echo \$\$ > dump.pid\n"
            . "NICE=''\ncommand -v nice >/dev/null 2>&1 && NICE='nice -n 10'\n"
            . 'BIN=' . escapeshellarg($bin) . "\n"
            . "OPTS=''\n"
            . "HELP=\$(\$BIN --help 2>&1)\n"
            . "case \"\$HELP\" in *no-tablespaces*) OPTS=\"\$OPTS --no-tablespaces\";; esac\n"
            . "case \"\$HELP\" in *set-gtid-purged*) OPTS=\"\$OPTS --set-gtid-purged=OFF\";; esac\n"
            . "case \"\$HELP\" in *column-statistics*) OPTS=\"\$OPTS --column-statistics=0\";; esac\n"
            . "FILTER=cat\ncommand -v sed >/dev/null 2>&1 && FILTER='sed -f dump.sed'\n"
            . 'COMPRESS=cat' . "\n" . ($gz ? "COMPRESS=\"\$NICE gzip\"\n" : '')
            . "( \$NICE \$BIN --defaults-extra-file=.dump.cnf --single-transaction --quick --skip-lock-tables --routines --triggers --hex-blob --default-character-set=utf8mb4 --verbose \$OPTS -- " . escapeshellarg($creds['name']) . " 2>dump.err; echo \$? > dump.exit ) | \$FILTER | \$COMPRESS > db.out.part\n"
            . "rm -f .dump.cnf\n"
            . 'mv -f db.out.part ' . escapeshellarg($st['file']) . "\n"
            . "echo done > dump.fin\n";
        $shPath = $this->tmp . '/dump.sh';
        if (@file_put_contents($shPath, $sh) === false) {
            throw new MigError('cannot write the dump script in the temp dir');
        }
        @chmod($shPath, 0700);
        foreach (array('dump.err', 'dump.exit', 'dump.fin', 'db.out.part', $st['file']) as $f) {
            @unlink($this->tmp . '/' . $f);
        }
        $st['pid'] = MigUtil::spawn($shPath, $this->tmp . '/dump.pid');
        $st['last_bytes'] = 0;
        $st['last_change'] = time();
        if ($st['pid'] <= 0) {
            @unlink($cnfPath);
            return $this->dumpFallbackToMysqli($st, 'could not start mysqldump in the background');
        }
        return $st;
    }

    private function dumpFallbackToMysqli($st, $why)
    {
        if (!empty($st['pid'])) {
            MigUtil::kill($st['pid']);
        }
        @unlink($this->tmp . '/.dump.cnf');
        if (!MigWp::mysqliAvailable() || $st['tables_total'] === null) {
            $st['error'] = $why;
            return $st;
        }
        self::note($st, 'switched to mysqli mode: ' . $why);
        $st['pid'] = 0;
        $st['started'] = time();
        return $this->dumpStartMysqli($st);
    }

    private static function countInFile($file, $needle)
    {
        $n = 0;
        $h = @fopen($file, 'rb');
        if (!$h) {
            return 0;
        }
        $carry = '';
        while (!feof($h)) {
            $chunk = fread($h, 262144);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $buf = $carry . $chunk;
            $n += substr_count($buf, $needle);
            $carry = substr($buf, -strlen($needle));
            if ($carry === false) {
                $carry = '';
            }
        }
        fclose($h);
        return $n;
    }

    /** Last meaningful lines of a tool's stderr (verbose "-- " lines dropped). */
    private static function tailFile($file, $bytes = 4096)
    {
        clearstatcache(true, $file);
        if (!is_file($file)) {
            return '';
        }
        $size = (int) filesize($file);
        $h = @fopen($file, 'rb');
        if (!$h) {
            return '';
        }
        if ($size > $bytes) {
            fseek($h, $size - $bytes);
        }
        $data = (string) stream_get_contents($h);
        fclose($h);
        $lines = array();
        foreach (preg_split('/\r?\n/', $data) as $l) {
            $l = trim($l);
            if ($l === '' || strncmp($l, '-- ', 3) === 0) {
                continue;
            }
            $lines[] = $l;
        }
        $lines = array_slice($lines, -3);
        return substr(implode(' | ', $lines), 0, 600);
    }

    private function dumpPollExec($st)
    {
        $errFile = $this->tmp . '/dump.err';
        $fin = $this->tmp . '/dump.fin';
        $refresh = function () use (&$st, $errFile) {
            clearstatcache();
            $done = self::countInFile($errFile, 'Retrieving table structure');
            $st['tables_done'] = ($st['tables_total'] !== null) ? min($done, $st['tables_total']) : $done;
            $rows = 0;
            $i = 0;
            foreach ($st['tables'] as $t) {
                if ($t['t'] !== 'table') {
                    continue;
                }
                if ($i++ >= $st['tables_done']) {
                    break;
                }
                $rows += (int) $t['r'];
            }
            $st['rows'] = $rows;
            $part = $this->tmp . '/db.out.part';
            $st['bytes'] = is_file($part) ? (int) filesize($part) : (is_file($this->tmp . '/' . $st['file']) ? (int) filesize($this->tmp . '/' . $st['file']) : 0);
        };
        $waitUntil = min($this->deadline, microtime(true) + 5);
        while (true) {
            $refresh();
            if (is_file($fin)) {
                $exit = trim((string) @file_get_contents($this->tmp . '/dump.exit'));
                $outFile = $this->tmp . '/' . $st['file'];
                if ($exit !== '0' || !is_file($outFile) || (int) filesize($outFile) === 0) {
                    $msg = self::tailFile($errFile);
                    return $this->dumpFallbackToMysqli($st, $st['tool'] . ' failed (exit ' . $exit . '): ' . ($msg !== '' ? $msg : 'no error output'));
                }
                $st['done'] = true;
                $st['finished'] = time();
                if ($st['tables_total'] !== null) {
                    $st['tables_done'] = $st['tables_total'];
                }
                $st['bytes'] = (int) filesize($outFile);
                @unlink($this->tmp . '/dump.pid');
                @unlink($this->tmp . '/dump.sh');
                @unlink($this->tmp . '/dump.sed');
                return $st;
            }
            $alive = MigUtil::pidAlive($st['pid']);
            if ($alive === false) {
                usleep(300000);
                clearstatcache();
                if (is_file($fin)) {
                    continue;
                }
                $msg = self::tailFile($errFile);
                return $this->dumpFallbackToMysqli($st, $st['tool'] . ' process died: ' . ($msg !== '' ? $msg : 'no error output'));
            }
            if ($st['bytes'] !== $st['last_bytes']) {
                $st['last_bytes'] = $st['bytes'];
                $st['last_change'] = time();
            } elseif (time() - $st['last_change'] > 1200) {
                MigUtil::kill($st['pid']);
                $st['error'] = 'mysqldump produced no output for 20 minutes';
                return $st;
            }
            if (microtime(true) >= $waitUntil) {
                return $st;
            }
            usleep(500000);
        }
    }

    private function dumpStartMysqli($st)
    {
        $st['mode'] = 'mysqli';
        $st['gz'] = MigOutput::gzAvailable();
        $st['file'] = $st['gz'] ? 'db.sql.gz' : 'db.sql';
        $st['cur'] = null;
        $st['idx'] = 0;
        $st['out_size'] = 0;
        $st['header'] = false;
        $st['tables_done'] = 0;
        $st['rows'] = 0;
        $st['bytes'] = 0;
        @unlink($this->tmp . '/' . $st['file']);
        return $st;
    }

    private function dumpWorkMysqli($st)
    {
        $creds = $this->dbCreds();
        if ($creds === null) {
            throw new MigError('database credentials not found');
        }
        $err = '';
        $m = MigWp::connect($creds, $err);
        if (!$m) {
            throw new MigError($err);
        }
        $out = new MigOutput($this->tmp . '/' . $st['file'], $st['gz'], (int) $st['out_size']);
        try {
            if (empty($st['header'])) {
                $out->write("-- SQL dump (mysqli mode)\n-- Database: " . $st['db'] . "\n-- Server: " . $m->server_info . "\n-- Generated: " . gmdate('Y-m-d H:i:s') . " UTC\n\n"
                    . "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\nSET TIME_ZONE='+00:00';\n\n");
                $st['header'] = true;
            }
            $steps = 0;
            while ($steps++ === 0 || !$this->overBudget()) {
                if ($st['cur'] === null) {
                    if ($st['idx'] >= count($st['tables'])) {
                        $out->write("\nSET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n-- dump completed\n");
                        $st['done'] = true;
                        $st['finished'] = time();
                        break;
                    }
                    $t = $st['tables'][$st['idx']];
                    if ($t['t'] === 'view') {
                        $this->dumpView($m, $t['n'], $out, $st);
                        $st['idx']++;
                        continue;
                    }
                    $st['cur'] = $this->dumpTableBegin($m, $t, $out);
                    continue;
                }
                $finished = $this->dumpTableBatch($m, $st['cur'], $out, $st);
                if ($finished) {
                    $st['tables_done']++;
                    $st['idx']++;
                    $st['cur'] = null;
                }
            }
            $st['out_size'] = $out->close();
            $st['bytes'] = $st['out_size'];
        } catch (Exception $e) {
            $out->abort();
            @$m->close();
            throw $e;
        }
        @$m->close();
        return $st;
    }

    private function dumpView($m, $name, MigOutput $out, &$st)
    {
        $q = MigUtil::backtick($name);
        $r = @$m->query("SHOW CREATE VIEW $q");
        if (!$r) {
            self::note($st, "view $name skipped: " . $m->error);
            return;
        }
        $row = $r->fetch_row();
        $r->free();
        $create = preg_replace('/\sDEFINER=`[^`]*`@`[^`]*`/', '', (string) $row[1]);
        $out->write("\n--\n-- View structure for view $q\n--\n\nDROP VIEW IF EXISTS $q;\n" . $create . ";\n\n");
    }

    private function dumpTableBegin($m, $t, MigOutput $out)
    {
        $name = $t['n'];
        $q = MigUtil::backtick($name);
        $r = @$m->query("SHOW CREATE TABLE $q");
        if (!$r) {
            throw new MigError("SHOW CREATE TABLE $name failed: " . $m->error);
        }
        $row = $r->fetch_row();
        $r->free();
        $out->write("\n--\n-- Table structure for table $q\n--\n\nDROP TABLE IF EXISTS $q;\n" . $row[1] . ";\n\n");

        $cols = array();
        $types = array();
        $r = @$m->query("SHOW FULL COLUMNS FROM $q");
        if (!$r) {
            throw new MigError("SHOW COLUMNS FROM $name failed: " . $m->error);
        }
        while ($c = $r->fetch_assoc()) {
            if (isset($c['Extra']) && stripos($c['Extra'], 'GENERATED') !== false) {
                continue; // generated columns cannot be inserted
            }
            $cols[] = $c['Field'];
            $types[$c['Field']] = strtolower((string) $c['Type']);
        }
        $r->free();

        // Keyset pagination needs a unique, fully indexed, NOT NULL column set: PRIMARY first,
        // else the smallest UNIQUE key (many WordPress plugin tables have UNIQUE KEY id (id)
        // and no PRIMARY KEY). Without one, LIMIT/OFFSET with large batches is the last resort.
        $keys = array();
        $r = @$m->query("SHOW KEYS FROM $q");
        if ($r) {
            while ($k = $r->fetch_assoc()) {
                $kn = $k['Key_name'];
                if (!isset($keys[$kn])) {
                    $keys[$kn] = array('unique' => ((int) $k['Non_unique'] === 0), 'cols' => array(), 'ok' => true);
                }
                $keys[$kn]['cols'][(int) $k['Seq_in_index']] = $k['Column_name'];
                if (strtoupper((string) $k['Null']) === 'YES' || (isset($k['Sub_part']) && $k['Sub_part'] !== null && $k['Sub_part'] !== '')
                    || !in_array($k['Column_name'], $cols, true) || (isset($k['Index_type']) && !in_array(strtoupper($k['Index_type']), array('BTREE', 'HASH'), true))) {
                    $keys[$kn]['ok'] = false;
                }
            }
            $r->free();
        }
        $keyCols = array();
        if (isset($keys['PRIMARY']) && $keys['PRIMARY']['ok']) {
            ksort($keys['PRIMARY']['cols']);
            $keyCols = array_values($keys['PRIMARY']['cols']);
        } else {
            $bestScore = null;
            foreach ($keys as $kn => $k) {
                if (!$k['unique'] || !$k['ok']) {
                    continue;
                }
                ksort($k['cols']);
                $c = array_values($k['cols']);
                $score = count($c) * 10 + ((count($c) === 1 && preg_match('/^(tiny|small|medium|big)?int\b/', $types[$c[0]])) ? 0 : 5);
                if ($bestScore === null || $score < $bestScore) {
                    $bestScore = $score;
                    $keyCols = $c;
                }
            }
        }
        $keyKinds = array();
        foreach ($keyCols as $kc) {
            $ty = $types[$kc];
            if (preg_match('/^(tiny|small|medium|big)?int\b|^(float|double|decimal|numeric|real|year)\b/', $ty)) {
                $keyKinds[] = 'n';
            } elseif (preg_match('/^(var)?binary\b|blob\b|^bit\b/', $ty)) {
                $keyKinds[] = 'x';
            } else {
                $keyKinds[] = 's';
            }
        }
        $pk = (count($keyCols) === 1) ? $keyCols[0] : null;
        $pkInt = ($pk !== null && $keyKinds[0] === 'n' && preg_match('/^(tiny|small|medium|big)?int\b/', $types[$pk]));
        // Batch size: 1000 rows on keyed tables (fewer when rows are large); keyless tables pay a
        // full scan per OFFSET, so they use big batches capped at about 20 MB.
        $avg = (!empty($t['r']) && !empty($t['b'])) ? $t['b'] / max(1, $t['r']) : 0;
        if ($keyCols) {
            $limit = MIG_SQL_BATCH_ROWS;
            if ($avg > 20000) {
                $limit = (int) max(20, min(MIG_SQL_BATCH_ROWS, floor(20000000 / $avg)));
            }
        } else {
            $limit = 20000;
            if ($avg > 1000) {
                $limit = (int) max(200, min(20000, floor(20000000 / $avg)));
            }
        }
        return array('n' => $name, 'cols' => $cols, 'pk' => $pk, 'pk_int' => $pkInt, 'pk_cols' => $keyCols, 'pk_kinds' => $keyKinds, 'last' => null, 'offset' => 0, 'rows' => 0, 'limit' => $limit);
    }

    /** SQL literal for a keyset value of the given kind ('n' numeric, 'x' binary, 's' string). */
    private static function keyLiteral($m, $v, $kind)
    {
        if ($v === null) {
            return 'NULL';
        }
        $v = base64_decode((string) $v, true);
        if ($v === false) {
            $v = '';
        }
        if ($kind === 'n' && preg_match('/^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/', (string) $v)) {
            return (string) $v;
        }
        if ($kind === 'x') {
            return ($v === '') ? "''" : '0x' . bin2hex($v);
        }
        return "'" . $m->real_escape_string((string) $v) . "'";
    }

    /** Dump one batch of rows; returns true when the table is finished. */
    private function dumpTableBatch($m, &$c, MigOutput $out, &$st)
    {
        $q = MigUtil::backtick($c['n']);
        if (!$c['cols']) {
            return true;
        }
        $colList = implode(',', array_map(array('MigUtil', 'backtick'), $c['cols']));
        $limit = (int) $c['limit'];
        $keyCols = $c['pk_cols'];
        if ($keyCols) {
            $order = implode(',', array_map(array('MigUtil', 'backtick'), $keyCols));
            $where = '';
            if (is_array($c['last'])) {
                // (k1 > v1) OR (k1 = v1 AND k2 > v2) OR ... : index-friendly on every MySQL/MariaDB
                $ors = array();
                $n = count($keyCols);
                for ($i = 0; $i < $n; $i++) {
                    $ands = array();
                    for ($j = 0; $j < $i; $j++) {
                        $ands[] = MigUtil::backtick($keyCols[$j]) . ' = ' . self::keyLiteral($m, $c['last'][$j], $c['pk_kinds'][$j]);
                    }
                    $ands[] = MigUtil::backtick($keyCols[$i]) . ' > ' . self::keyLiteral($m, $c['last'][$i], $c['pk_kinds'][$i]);
                    $ors[] = '(' . implode(' AND ', $ands) . ')';
                }
                $where = ' WHERE ' . implode(' OR ', $ors);
            }
            $sql = "SELECT $colList FROM $q$where ORDER BY $order LIMIT $limit";
        } else {
            $sql = "SELECT $colList FROM $q LIMIT $limit OFFSET " . (int) $c['offset'];
        }
        $res = @$m->query($sql, MYSQLI_USE_RESULT);
        if (!$res) {
            throw new MigError('SELECT from ' . $c['n'] . ' failed: ' . $m->error);
        }
        $numeric = array();
        $binary = array();
        $numTypes = array(MYSQLI_TYPE_TINY, MYSQLI_TYPE_SHORT, MYSQLI_TYPE_LONG, MYSQLI_TYPE_FLOAT, MYSQLI_TYPE_DOUBLE, MYSQLI_TYPE_LONGLONG, MYSQLI_TYPE_INT24, MYSQLI_TYPE_DECIMAL, MYSQLI_TYPE_NEWDECIMAL, MYSQLI_TYPE_YEAR);
        $binTypes = array(MYSQLI_TYPE_TINY_BLOB, MYSQLI_TYPE_MEDIUM_BLOB, MYSQLI_TYPE_LONG_BLOB, MYSQLI_TYPE_BLOB, MYSQLI_TYPE_STRING, MYSQLI_TYPE_VAR_STRING, MYSQLI_TYPE_BIT, MYSQLI_TYPE_GEOMETRY);
        foreach ($res->fetch_fields() as $i => $f) {
            $numeric[$i] = in_array($f->type, $numTypes, true);
            $binary[$i] = !$numeric[$i] && (int) $f->charsetnr === 63 && in_array($f->type, $binTypes, true);
        }
        $keyIdx = array();
        foreach ($keyCols as $kc) {
            $keyIdx[] = array_search($kc, $c['cols'], true);
        }
        $count = 0;
        $buf = '';
        $open = false;
        $lastRow = null;
        while ($row = $res->fetch_row()) {
            $count++;
            $vals = array();
            foreach ($row as $i => $v) {
                if ($v === null) {
                    $vals[] = 'NULL';
                } elseif ($numeric[$i]) {
                    $vals[] = ($v === '' || !preg_match('/^-?[0-9.eE+-]+$/', $v)) ? "'" . $m->real_escape_string($v) . "'" : $v;
                } elseif ($binary[$i]) {
                    $vals[] = ($v === '') ? "''" : '0x' . bin2hex($v);
                } else {
                    $vals[] = "'" . $m->real_escape_string($v) . "'";
                }
            }
            $tuple = '(' . implode(',', $vals) . ')';
            if (!$open) {
                $buf .= "INSERT INTO $q ($colList) VALUES\n" . $tuple;
                $open = true;
            } else {
                $buf .= ",\n" . $tuple;
            }
            if (strlen($buf) >= MIG_SQL_BATCH_BYTES) {
                $out->write($buf . ";\n");
                $buf = '';
                $open = false;
            }
            if ($keyIdx) {
                $lastRow = $row;
            }
        }
        $res->free();
        if ($open) {
            $out->write($buf . ";\n");
        }
        if ($keyIdx && $count > 0) {
            $last = array();
            foreach ($keyIdx as $ix) {
                // base64: raw key bytes must survive the JSON state file unchanged
                $last[] = ($lastRow[$ix] === null) ? null : base64_encode($lastRow[$ix]);
            }
            $c['last'] = $last;
        }
        $c['rows'] += $count;
        $c['offset'] += $count;
        $st['rows'] += $count;
        return $count < $limit;
    }

    /* ---------------------------------------------------------------- archive */

    public function actionArchive()
    {
        $this->ensureTmp();
        $st = $this->stateRead('archive.state.json');
        if ($st === null || $this->param('restart') === '1') {
            if ($st !== null) {
                $this->archiveDiscard($st);
            }
            $st = $this->archiveStart();
        }
        if (!empty($st['done'])) {
            return $this->archiveDone($st);
        }
        if (!empty($st['error'])) {
            return array('ok' => false, 'error' => $st['error'], 'mode' => $st['mode']);
        }
        if ($st['phase'] === 'list') {
            $st = $this->archiveList($st);
        }
        if ($st['phase'] === 'write' && empty($st['error'])) {
            $st = ($st['mode'] === 'exec') ? $this->archivePollExec($st) : $this->archiveWritePhp($st);
        }
        $this->stateWrite('archive.state.json', $st);
        if (!empty($st['done'])) {
            return $this->archiveDone($st);
        }
        if (!empty($st['error'])) {
            return array('ok' => false, 'error' => $st['error'], 'mode' => $st['mode']);
        }
        return array('ok' => true, 'done' => false, 'mode' => $st['mode'], 'progress' => $this->archiveProgress($st));
    }

    private function archiveProgress($st)
    {
        $bytes = (int) $st['bytes'];
        if (!empty($st['cur'])) {
            $bytes += (int) $st['cur']['offset'];
        }
        return array(
            'files' => (int) $st['files'],
            'bytes' => $bytes,
            'files_total' => (int) $st['files_total'],
            'bytes_total' => (int) $st['bytes_total'],
            'total_partial' => !empty($st['total_partial']),
            'phase' => $st['phase'],
            'out_bytes' => isset($st['out_bytes']) ? (int) $st['out_bytes'] : 0,
            'elapsed' => time() - (int) $st['started'],
        );
    }

    private function archiveDone($st)
    {
        $parts = array();
        foreach ($st['parts'] as $p) {
            clearstatcache(true, $this->tmp . '/' . $p);
            $parts[] = array('file' => $p, 'size' => (int) @filesize($this->tmp . '/' . $p));
        }
        return array(
            'ok' => true,
            'done' => true,
            'mode' => $st['mode'],
            'parts' => $parts,
            'files' => (int) $st['files'],
            'bytes' => (int) $st['bytes'],
            'files_total' => (int) $st['files_total'],
            'bytes_total' => (int) $st['bytes_total'],
            'notes' => isset($st['notes']) ? $st['notes'] : array(),
            'notes_count' => isset($st['notes_count']) ? (int) $st['notes_count'] : 0,
            'elapsed' => (isset($st['finished']) ? (int) $st['finished'] : time()) - (int) $st['started'],
        );
    }

    private function archiveDiscard($st)
    {
        if (!empty($st['pid'])) {
            MigUtil::kill($st['pid']);
        }
        foreach (array('archive.index', 'archive.files', 'archive.list', 'archive.sh', 'archive.pid', 'archive.tarexit', 'archive.fin', 'archive.split', 'files.out.part', 'files.tar', 'files.tar.gz', 'archive.state.json') as $f) {
            @unlink($this->tmp . '/' . $f);
        }
        foreach ((array) @glob($this->tmp . '/files.tar*') as $f) {
            @unlink($f);
        }
    }

    private function archiveStart()
    {
        $exec = MigUtil::execAvailable() && MigUtil::haveBinary('tar') !== '';
        $st = array(
            'mode' => $exec ? 'exec' : 'php',
            'started' => time(),
            'phase' => 'list',
            'stack' => array(''),
            'files_total' => 0,
            'bytes_total' => 0,
            'total_partial' => false,
            'files' => 0,
            'bytes' => 0,
            'out_bytes' => 0,
            'done' => false,
            'error' => '',
            'notes' => array(),
            'parts' => array(),
            'cur' => null,
            'cursor' => 0,
            'out_size' => 0,
            'gz' => $exec ? (MigUtil::haveBinary('gzip') !== '') : MigOutput::gzAvailable(),
        );
        $st['file'] = $st['gz'] ? 'files.tar.gz' : 'files.tar';
        @unlink($this->tmp . '/archive.index');
        @unlink($this->tmp . '/' . $st['file']);
        $this->stateWrite('archive.state.json', $st);
        return $st;
    }

    /** Listing phase (both modes): resumable walk; php mode also writes the index file. */
    private function archiveList($st)
    {
        $w = $this->walker();
        $w->stack = $st['stack'];
        $ih = null;
        if ($st['mode'] === 'php') {
            $ih = @fopen($this->tmp . '/archive.index', 'ab');
            if (!$ih) {
                throw new MigError('cannot write the archive index in the temp dir');
            }
        }
        $finished = $w->step($this->deadline, function ($kind, $rel, $size) use (&$st, $ih) {
            switch ($kind) {
                case 'dir':
                case 'file':
                case 'link':
                    $st['files_total']++;
                    $st['bytes_total'] += $size;
                    if ($ih) {
                        fwrite($ih, $kind[0] . "\t" . $size . "\t" . addcslashes($rel, "\0..\37\\") . "\n");
                    }
                    break;
                case 'special':
                    self::note($st, 'skipped special file: ' . $rel);
                    break;
                case 'unreadable':
                    self::note($st, 'unreadable directory: ' . ($rel === '' ? '.' : $rel));
                    break;
            }
        });
        if ($ih) {
            fclose($ih);
        }
        $st['stack'] = $w->stack;
        if (!$finished) {
            return $st;
        }
        $st['phase'] = 'write';
        $st['stack'] = array();
        if ($st['mode'] === 'exec') {
            $st = $this->archiveStartExec($st);
        }
        return $st;
    }

    private function archiveStartExec($st)
    {
        $tar = MigUtil::haveBinary('tar');
        list($code, $ver) = MigUtil::run(escapeshellarg($tar) . ' --version', 5);
        $gnu = (stripos($ver, 'GNU tar') !== false);
        $st['tar'] = $gnu ? 'gnu' : 'other';

        // Top-level entries (the temp dir and the helper are never listed).
        $entries = @scandir($this->docroot, SCANDIR_SORT_ASCENDING);
        if ($entries === false) {
            $st['error'] = 'cannot list the docroot';
            return $st;
        }
        $list = '';
        foreach ($entries as $e) {
            if ($e === '.' || $e === '..' || $e === $this->tmpName || strncmp($e, '.mig-tmp-', 9) === 0 || $e === $this->helperRel) {
                continue;
            }
            if (strpos($e, "\n") !== false || strpos($e, "\r") !== false) {
                self::note($st, 'skipped entry with a newline in its name');
                continue;
            }
            $list .= ($e[0] === '-' ? './' . $e : $e) . "\n";
        }
        if (@file_put_contents($this->tmp . '/archive.files', $list) === false) {
            throw new MigError('cannot write the archive file list');
        }

        $args = array('-c', '-v', '-f', '-');
        if ($gnu) {
            $args[] = '--warning=no-file-changed';
            $args[] = '--warning=no-file-removed';
            $args[] = '--ignore-failed-read';
        }
        $ex = array('.git', 'debug.log', 'error_log', '*.wpress', '.mig-tmp-*', 'wp-content/cache', 'wp-content/ai1wm-backups', 'wp-content/updraft', 'wp-content/plugins/mig-helper');
        if ($this->helperRel !== '') {
            $ex[] = $this->helperRel;
        }
        $wc = @scandir($this->docroot . '/wp-content');
        if (is_array($wc)) {
            foreach ($wc as $e) {
                if ($e === '.' || $e === '..' || !is_dir($this->docroot . '/wp-content/' . $e) || is_link($this->docroot . '/wp-content/' . $e)) {
                    continue;
                }
                if (stripos($e, 'cache') !== false || strncmp($e, 'backups-dup-', 12) === 0) {
                    $ex[] = 'wp-content/' . $e;
                }
            }
        }
        foreach ($ex as $p) {
            $args[] = '--exclude=' . $p;
        }
        $args[] = '-T';
        $args[] = $this->tmp . '/archive.files';
        $flags = implode(' ', array_map('escapeshellarg', $args));

        $T = escapeshellarg($this->tmp);
        $split = ($st['bytes_total'] > MIG_PART_BYTES || !empty($st['total_partial'])) && MigUtil::haveBinary('split') !== '';
        $sh = "#!/bin/sh\n"
            . 'cd ' . escapeshellarg($this->docroot) . " || exit 1\n"
            . 'T=' . $T . "\n"
            . "echo \$\$ > \"\$T/archive.pid\"\n"
            . "NICE=''\ncommand -v nice >/dev/null 2>&1 && NICE='nice -n 10'\n"
            . 'COMPRESS=cat' . "\n" . ($st['gz'] ? "COMPRESS=\"\$NICE gzip\"\n" : '')
            . '( $NICE ' . escapeshellarg($tar) . ' ' . $flags . " 2>\"\$T/archive.list\"; echo \$? > \"\$T/archive.tarexit\" ) | \$COMPRESS > \"\$T/files.out.part\"\n"
            . "SIZE=\$(wc -c < \"\$T/files.out.part\" | tr -d ' ')\n"
            . 'if [ ' . ($split ? '1' : '0') . " = 1 ] && [ \"\$SIZE\" -gt " . MIG_PART_BYTES . " ]; then\n"
            . "  ( cd \"\$T\" && split -b " . MIG_PART_BYTES . ' files.out.part ' . escapeshellarg($st['file'] . '.') . " && rm -f files.out.part && echo split > archive.split )\n"
            . "else\n"
            . "  mv -f \"\$T/files.out.part\" \"\$T/\"" . escapeshellarg($st['file']) . "\n"
            . "fi\n"
            . "echo done > \"\$T/archive.fin\"\n";
        $shPath = $this->tmp . '/archive.sh';
        if (@file_put_contents($shPath, $sh) === false) {
            throw new MigError('cannot write the archive script');
        }
        @chmod($shPath, 0700);
        foreach (array('archive.list', 'archive.tarexit', 'archive.fin', 'archive.split', 'files.out.part') as $f) {
            @unlink($this->tmp . '/' . $f);
        }
        $st['list_offset'] = 0;
        $st['last_bytes'] = 0;
        $st['last_change'] = time();
        $st['pid'] = MigUtil::spawn($shPath, $this->tmp . '/archive.pid');
        if ($st['pid'] <= 0) {
            // fall back to the pure-PHP writer: rebuild the index in a fresh listing
            self::note($st, 'could not start tar in the background, using the PHP writer');
            $st['mode'] = 'php';
            $st['gz'] = MigOutput::gzAvailable();
            $st['file'] = $st['gz'] ? 'files.tar.gz' : 'files.tar';
            $st['phase'] = 'list';
            $st['stack'] = array('');
            $st['files_total'] = 0;
            $st['bytes_total'] = 0;
            @unlink($this->tmp . '/archive.index');
        }
        return $st;
    }

    private function archivePollExec($st)
    {
        $listFile = $this->tmp . '/archive.list';
        $fin = $this->tmp . '/archive.fin';
        $waitUntil = min($this->deadline, microtime(true) + 5);
        while (true) {
            clearstatcache();
            // consume new lines of the verbose listing
            $h = @fopen($listFile, 'rb');
            if ($h) {
                fseek($h, (int) $st['list_offset']);
                $n = 0;
                while (($line = fgets($h)) !== false) {
                    if (substr($line, -1) !== "\n") {
                        break;
                    }
                    $st['list_offset'] += strlen($line);
                    $line = rtrim($line, "\r\n");
                    if ($line === '') {
                        continue;
                    }
                    if (preg_match('/^(bsd)?tar: /', $line) || preg_match('#^/[^ ]*/tar: #', $line)) {
                        self::note($st, $line);
                        continue;
                    }
                    $name = $line;
                    if (strncmp($name, 'a ', 2) === 0 && !file_exists($this->docroot . '/' . rtrim($name, '/')) && $st['tar'] !== 'gnu') {
                        $name = substr($name, 2);
                    }
                    if (strpos($name, '\\') !== false) {
                        $name = stripcslashes($name);
                    }
                    $st['files']++;
                    $l = @lstat($this->docroot . '/' . rtrim($name, '/'));
                    if ($l !== false && ($l['mode'] & 0170000) === 0100000) {
                        $st['bytes'] += (int) $l['size'];
                    }
                    if (++$n >= 200000 || $this->overBudget()) {
                        break;
                    }
                }
                fclose($h);
            }
            $part = $this->tmp . '/files.out.part';
            $st['out_bytes'] = is_file($part) ? (int) filesize($part) : 0;

            if (is_file($fin)) {
                $exit = trim((string) @file_get_contents($this->tmp . '/archive.tarexit'));
                if (!ctype_digit($exit) || (int) $exit >= 2) {
                    $st['error'] = 'tar failed (exit ' . $exit . '): ' . self::tailFile($listFile);
                    return $st;
                }
                if ($exit === '1') {
                    self::note($st, 'tar reported warnings (some files changed or vanished while reading)');
                }
                $parts = array();
                if (is_file($this->tmp . '/archive.split')) {
                    foreach ((array) @glob($this->tmp . '/' . $st['file'] . '.*') as $p) {
                        $parts[] = basename($p);
                    }
                    sort($parts, SORT_STRING);
                } elseif (is_file($this->tmp . '/' . $st['file'])) {
                    $parts[] = $st['file'];
                }
                if (!$parts) {
                    $st['error'] = 'tar produced no output: ' . self::tailFile($listFile);
                    return $st;
                }
                $total = 0;
                foreach ($parts as $p) {
                    $total += (int) @filesize($this->tmp . '/' . $p);
                }
                $st['parts'] = $parts;
                $st['out_bytes'] = $total;
                $st['done'] = true;
                $st['finished'] = time();
                foreach (array('archive.pid', 'archive.sh', 'archive.files', 'archive.tarexit', 'archive.split') as $f) {
                    @unlink($this->tmp . '/' . $f);
                }
                return $st;
            }
            $alive = MigUtil::pidAlive($st['pid']);
            if ($alive === false) {
                usleep(300000);
                clearstatcache();
                if (is_file($fin)) {
                    continue;
                }
                $st['error'] = 'tar process died: ' . self::tailFile($listFile);
                return $st;
            }
            $probe = $st['out_bytes'] . ':' . $st['list_offset'];
            if ($probe !== $st['last_bytes']) {
                $st['last_bytes'] = $probe;
                $st['last_change'] = time();
            } elseif (time() - $st['last_change'] > 1200) {
                MigUtil::kill($st['pid']);
                $st['error'] = 'tar produced no output for 20 minutes';
                return $st;
            }
            if (microtime(true) >= $waitUntil) {
                return $st;
            }
            usleep(500000);
        }
    }

    private function archiveWritePhp($st)
    {
        $ih = @fopen($this->tmp . '/archive.index', 'rb');
        if (!$ih) {
            throw new MigError('archive index missing; call archive with restart=1');
        }
        fseek($ih, (int) $st['cursor']);
        $out = new MigOutput($this->tmp . '/' . $st['file'], $st['gz'], (int) $st['out_size']);
        $tar = new MigTar($out);
        $entries = 0;
        try {
            if (!empty($st['cur'])) {
                $this->archiveResumeFile($tar, $st);
            }
            while (empty($st['cur'])) {
                if ($entries++ > 0 && $this->overBudget()) {
                    break;
                }
                $pos = ftell($ih);
                $line = fgets($ih);
                if ($line === false) {
                    $tar->finish();
                    $st['done'] = true;
                    $st['finished'] = time();
                    $st['cursor'] = $pos;
                    $st['parts'] = array($st['file']);
                    break;
                }
                $st['cursor'] = ftell($ih);
                $parts = explode("\t", rtrim($line, "\r\n"), 3);
                if (count($parts) !== 3) {
                    continue;
                }
                $kind = $parts[0];
                $rel = stripcslashes($parts[2]);
                $abs = $this->docroot . '/' . $rel;
                $l = @lstat($abs);
                if ($l === false) {
                    self::note($st, 'vanished: ' . $rel);
                    continue;
                }
                $fmt = $l['mode'] & 0170000;
                if ($kind === 'd') {
                    if ($fmt !== 0040000) {
                        self::note($st, 'changed type, skipped: ' . $rel);
                        continue;
                    }
                    $tar->header($rel . '/', $l['mode'], $l['uid'], $l['gid'], 0, $l['mtime'], '5');
                    $st['files']++;
                    continue;
                }
                if ($kind === 'l') {
                    $target = ($fmt === 0120000) ? @readlink($abs) : false;
                    if ($target === false) {
                        self::note($st, 'changed type, skipped: ' . $rel);
                        continue;
                    }
                    $tar->header($rel, 0777, $l['uid'], $l['gid'], 0, $l['mtime'], '2', $target);
                    $st['files']++;
                    continue;
                }
                if ($fmt !== 0100000) {
                    self::note($st, 'changed type, skipped: ' . $rel);
                    continue;
                }
                $fh = @fopen($abs, 'rb');
                if (!$fh) {
                    self::note($st, 'unreadable, skipped: ' . $rel);
                    continue;
                }
                $fs = fstat($fh);
                $size = (int) $fs['size'];
                $tar->header($rel, $l['mode'], $l['uid'], $l['gid'], $size, $l['mtime'], '0');
                $st['cur'] = array('rel' => $rel, 'size' => $size, 'offset' => 0);
                $this->archiveStreamFile($tar, $fh, $st);
                fclose($fh);
            }
            $st['out_size'] = $out->close();
            $st['out_bytes'] = $st['out_size'];
        } catch (Exception $e) {
            $out->abort();
            fclose($ih);
            throw $e;
        }
        fclose($ih);
        return $st;
    }

    /** Continue a file whose header was written in an earlier call. */
    private function archiveResumeFile(MigTar $tar, &$st)
    {
        $c = $st['cur'];
        $fh = @fopen($this->docroot . '/' . $c['rel'], 'rb');
        if ($fh) {
            $fs = fstat($fh);
            if ((int) $fs['size'] < (int) $c['size'] || fseek($fh, (int) $c['offset']) !== 0) {
                fclose($fh);
                $fh = false;
            }
        }
        if (!$fh) {
            self::note($st, 'changed while archiving, rest zero-filled: ' . $c['rel']);
            $this->archivePad($tar, $st, (int) $c['size'] - (int) $c['offset']);
            $tar->data(MigTar::padding((int) $c['size']));
            $st['files']++;
            $st['bytes'] += (int) $c['size'];
            $st['cur'] = null;
            return;
        }
        $this->archiveStreamFile($tar, $fh, $st);
        fclose($fh);
    }

    private function archivePad(MigTar $tar, &$st, $n)
    {
        while ($n > 0) {
            $k = (int) min($n, 1048576);
            $tar->data(str_repeat("\0", $k));
            $n -= $k;
            $st['cur']['offset'] += $k;
        }
    }

    /** Stream the current file (state in $st['cur']) until done or out of budget. */
    private function archiveStreamFile(MigTar $tar, $fh, &$st)
    {
        $size = (int) $st['cur']['size'];
        $left = $size - (int) $st['cur']['offset'];
        while ($left > 0) {
            $chunk = @fread($fh, (int) min(1048576, $left));
            if ($chunk === false || $chunk === '') {
                self::note($st, 'shrank while archiving, rest zero-filled: ' . $st['cur']['rel']);
                $this->archivePad($tar, $st, $left);
                $left = 0;
                break;
            }
            $tar->data($chunk);
            $st['cur']['offset'] += strlen($chunk);
            $left -= strlen($chunk);
            if ($left > 0 && $this->overBudget()) {
                return false; // resumed by the next call
            }
        }
        $tar->data(MigTar::padding($size));
        $st['files']++;
        $st['bytes'] += $size;
        $st['cur'] = null;
        return true;
    }

    /* ---------------------------------------------------------------- dispatch / entry */

    public function dispatch($action)
    {
        switch ($action) {
            case 'info':
                return $this->actionInfo();
            case 'dump':
                return $this->actionDump();
            case 'archive':
                return $this->actionArchive();
            case 'get':
                return $this->actionGet();
            case 'cleanup':
                return $this->actionCleanup();
        }
        throw new MigError('unknown action' . ($action === '' ? '' : ': ' . substr(preg_replace('/[^A-Za-z0-9_-]/', '', $action), 0, 32)));
    }

    public function handle($action)
    {
        if ($action === 'dump' || $action === 'archive' || $action === 'cleanup') {
            $this->ensureTmp();
            if (!$this->lock($action)) {
                throw new MigError('busy', 200, array('busy' => true));
            }
        }
        $data = $this->dispatch($action);
        $this->unlock();
        self::respond($data, 200, $this->cli);
    }

    public static function begin()
    {
        @ini_set('display_errors', '0');
        @ini_set('html_errors', '0');
        @ini_set('zlib.output_compression', '0');
        error_reporting(E_ALL);
        set_error_handler(function ($no, $str, $file, $line) {
            return true; // never let a warning/notice reach the output
        });
        register_shutdown_function(function () {
            $e = error_get_last();
            if ($e && !MigAgent::$responded && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR), true)) {
                MigAgent::respond(array('ok' => false, 'error' => 'fatal: ' . $e['message'] . ' (line ' . $e['line'] . ')'), 200);
            }
        });
        ob_start();
    }

    public static function respond($data, $status = 200, $cli = false)
    {
        self::$responded = true;
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        $body = MigUtil::jsonEncode($data) . "\n";
        if ($cli || PHP_SAPI === 'cli') {
            echo $body;
            exit(!empty($data['ok']) ? 0 : 1);
        }
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
            header('Pragma: no-cache');
            header('X-Content-Type-Options: nosniff');
            header('X-Robots-Tag: noindex, nofollow');
            if ($status === 416 && isset($data['size'])) {
                header('Content-Range: bytes */' . (int) $data['size']);
            }
            header('Content-Length: ' . strlen($body));
        }
        echo $body;
        exit;
    }

    /** Token (constant time), expiry and optional client IP. Throws MigError(403). */
    public static function authorize($cfgToken, $cfgExpires, $cfgIp, $given)
    {
        if (!is_string($cfgToken) || !preg_match('/^[0-9a-f]{32}$/i', $cfgToken)) {
            throw new MigError('agent not configured', 403);
        }
        if (!is_string($given) || !hash_equals($cfgToken, $given)) {
            throw new MigError('forbidden', 403);
        }
        $exp = is_numeric($cfgExpires) ? (int) $cfgExpires : 0;
        if ($exp <= 0 || time() > $exp) {
            throw new MigError('expired', 403);
        }
        $cfgIp = trim((string) $cfgIp);
        if ($cfgIp !== '' && $cfgIp !== '__' . 'ALLOWED_IP__') {
            $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
            if (!MigUtil::ipMatches($cfgIp, $remote)) {
                throw new MigError('forbidden', 403);
            }
        }
    }

    public static function configuredDocroot()
    {
        $d = MIG_CFG_DOCROOT;
        if ($d === '' || $d === '__' . 'DOCROOT__') {
            return dirname(__FILE__);
        }
        return $d;
    }

    public static function givenToken()
    {
        if (isset($_GET['token'])) {
            return $_GET['token'];
        }
        if (isset($_POST['token'])) {
            return $_POST['token'];
        }
        if (isset($_SERVER['HTTP_X_MT_TOKEN'])) {
            return $_SERVER['HTTP_X_MT_TOKEN'];
        }
        return '';
    }

    public static function runHttp()
    {
        self::begin();
        try {
            self::authorize(MIG_CFG_TOKEN, MIG_CFG_EXPIRES, MIG_CFG_ALLOWED_IP, self::givenToken());
            $params = array_merge(is_array($_POST) ? $_POST : array(), is_array($_GET) ? $_GET : array());
            $agent = new MigAgent(self::configuredDocroot(), $params, array());
            $agent->handle(isset($params['action']) && is_string($params['action']) ? $params['action'] : '');
        } catch (MigError $e) {
            self::respond(array_merge(array('ok' => false, 'error' => $e->getMessage()), $e->extra), $e->status);
        } catch (Exception $e) {
            self::respond(array('ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()), 200);
        } catch (Throwable $e) {
            self::respond(array('ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()), 200);
        }
    }

    public static function runCli($argv)
    {
        self::begin();
        try {
            $action = isset($argv[1]) ? (string) $argv[1] : '';
            $params = array();
            for ($i = 2; $i < count($argv); $i++) {
                if (strpos($argv[$i], '=') !== false) {
                    list($k, $v) = explode('=', $argv[$i], 2);
                    $params[$k] = $v;
                }
            }
            $docroot = getenv('MIG_DOCROOT');
            if (!is_string($docroot) || $docroot === '') {
                $docroot = self::configuredDocroot();
            }
            $tmp = getenv('MIG_TMP');
            $agent = new MigAgent($docroot, $params, array('cli' => true, 'tmp' => is_string($tmp) ? $tmp : ''));
            $agent->handle($action);
        } catch (MigError $e) {
            self::respond(array_merge(array('ok' => false, 'error' => $e->getMessage(), 'status' => $e->status), $e->extra), $e->status, true);
        } catch (Exception $e) {
            self::respond(array('ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()), 200, true);
        } catch (Throwable $e) {
            self::respond(array('ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()), 200, true);
        }
    }
}

/**
 * Plugin mode entry point, called by mig-helper.php from the admin-ajax hooks.
 * Token/expiry/IP come from the option mig_helper_token (fallback: the constants baked
 * into the wrapper); the docroot is ABSPATH.
 */
function mig_agent_plugin_request()
{
    MigAgent::begin();
    try {
        $opt = function_exists('get_option') ? get_option('mig_helper_token') : false;
        $token = '';
        $exp = 0;
        $ip = '';
        if (is_array($opt)) {
            $token = isset($opt['token']) ? (string) $opt['token'] : '';
            $exp = isset($opt['expires']) ? (int) $opt['expires'] : 0;
            $ip = isset($opt['allowed_ip']) ? (string) $opt['allowed_ip'] : '';
        }
        if (!preg_match('/^[0-9a-f]{32}$/i', $token) && defined('MIG_HELPER_TOKEN')) {
            $token = (string) MIG_HELPER_TOKEN;
            $exp = defined('MIG_HELPER_EXPIRES') ? (int) MIG_HELPER_EXPIRES : 0;
            $ip = defined('MIG_HELPER_ALLOWED_IP') ? (string) MIG_HELPER_ALLOWED_IP : '';
        }
        MigAgent::authorize($token, $exp, $ip, MigAgent::givenToken());
        $params = array_merge(is_array($_POST) ? $_POST : array(), is_array($_GET) ? $_GET : array());
        if (function_exists('wp_unslash')) {
            $params = wp_unslash($params);
        }
        $docroot = defined('ABSPATH') ? rtrim(DIRECTORY_SEPARATOR === '\\' ? str_replace('\\', '/', ABSPATH) : ABSPATH, '/') : dirname(__FILE__);
        $agent = new MigAgent($docroot, $params, array('plugin' => true));
        $agent->handle(isset($params['mig_action']) && is_string($params['mig_action']) ? $params['mig_action'] : '');
    } catch (MigError $e) {
        MigAgent::respond(array_merge(array('ok' => false, 'error' => $e->getMessage()), $e->extra), $e->status);
    } catch (Exception $e) {
        MigAgent::respond(array('ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()), 200);
    } catch (Throwable $e) {
        MigAgent::respond(array('ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()), 200);
    }
}

if (!defined('MIG_AGENT_PLUGIN_MODE')) {
    if (PHP_SAPI === 'cli') {
        MigAgent::runCli(isset($_SERVER['argv']) ? $_SERVER['argv'] : array());
    } else {
        MigAgent::runHttp();
    }
}
