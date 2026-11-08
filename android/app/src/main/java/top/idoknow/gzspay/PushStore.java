package top.idoknow.gzspay;

import android.content.Context;
import android.content.SharedPreferences;

/** FCM 令牌的本地缓存：服务重启或网页还没加载时也能拿到最近一次令牌。 */
public final class PushStore {

    private static final String PREFS = "gzspay_push";
    private static final String KEY_TOKEN = "token";

    private PushStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String token(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }

    public static void saveToken(Context context, String token) {
        if (token == null) {
            return;
        }
        prefs(context).edit().putString(KEY_TOKEN, token).apply();
    }

    public static void clear(Context context) {
        prefs(context).edit().remove(KEY_TOKEN).apply();
    }
}
