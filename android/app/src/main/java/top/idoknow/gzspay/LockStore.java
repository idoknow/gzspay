package top.idoknow.gzspay;

import android.content.Context;
import android.content.SharedPreferences;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * 应用锁的本地存储：只保存加盐哈希，不保存明文密码或手势。
 */
public final class LockStore {

    public static final int TYPE_NONE = 0;
    public static final int TYPE_PIN4 = 4;
    public static final int TYPE_PIN6 = 6;
    public static final int TYPE_PATTERN = 7;

    private static final String PREFS = "gzspay_lock";
    private static final String KEY_TYPE = "type";
    private static final String KEY_SALT = "salt";
    private static final String KEY_HASH = "hash";
    private static final String KEY_BIOMETRIC = "biometric";

    /** 回到前台超过这个时间就重新上锁。 */
    private static final long RELOCK_AFTER_MS = 30_000L;

    private static long lastUnlockAt = 0L;
    private static long lastPauseAt = 0L;

    private LockStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static int getType(Context context) {
        return prefs(context).getInt(KEY_TYPE, TYPE_NONE);
    }

    public static boolean hasLock(Context context) {
        return getType(context) != TYPE_NONE;
    }

    public static boolean isBiometricEnabled(Context context) {
        return prefs(context).getBoolean(KEY_BIOMETRIC, false) && hasLock(context);
    }

    public static void setBiometricEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_BIOMETRIC, enabled).apply();
    }

    public static void saveCode(Context context, int type, String code) {
        String salt = newSalt();
        SharedPreferences.Editor editor = prefs(context).edit();
        editor.putInt(KEY_TYPE, type);
        editor.putString(KEY_SALT, salt);
        editor.putString(KEY_HASH, hash(salt, code));
        editor.apply();
        if (type != TYPE_PATTERN) {
            editor.putBoolean(KEY_BIOMETRIC, prefs(context).getBoolean(KEY_BIOMETRIC, false)).apply();
        }
        unlockNow();
    }

    public static void clear(Context context) {
        prefs(context).edit().clear().apply();
        lastUnlockAt = 0L;
        lastPauseAt = 0L;
    }

    public static boolean verify(Context context, String code) {
        SharedPreferences prefs = prefs(context);
        String salt = prefs.getString(KEY_SALT, null);
        String expected = prefs.getString(KEY_HASH, null);
        if (salt == null || expected == null) {
            return false;
        }
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                hash(salt, code).getBytes(StandardCharsets.UTF_8));
    }

    public static void unlockNow() {
        lastUnlockAt = System.currentTimeMillis();
    }

    public static void onAppBackground() {
        lastPauseAt = System.currentTimeMillis();
    }

    /** 冷启动、或者离开超过 30 秒，都需要重新验证。 */
    public static boolean needsUnlock(Context context) {
        if (!hasLock(context)) {
            return false;
        }
        if (lastUnlockAt == 0L) {
            return true;
        }
        if (lastPauseAt > lastUnlockAt) {
            return System.currentTimeMillis() - lastPauseAt > RELOCK_AFTER_MS;
        }
        return false;
    }

    private static String newSalt() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        return toHex(bytes);
    }

    private static String hash(String salt, String code) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(salt.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) ':');
            digest.update(code.getBytes(StandardCharsets.UTF_8));
            return toHex(digest.digest());
        } catch (Exception cause) {
            throw new IllegalStateException(cause);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(Character.forDigit((value >> 4) & 0xF, 16));
            builder.append(Character.forDigit(value & 0xF, 16));
        }
        return builder.toString();
    }
}
