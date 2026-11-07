package top.idoknow.gzspay;

import android.content.Context;
import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 用 WebView 里已登录的 Cookie 调一次 /api/me/nfc-card，拿到 NFC 卡片链接给 HCE 服务用。
 */
public final class NfcCardSync {

    private static final String TAG = "gzspay-nfc";

    private NfcCardSync() {
    }

    public static void refresh(Context context) {
        final Context appContext = context.getApplicationContext();
        new Thread(() -> {
            try {
                String base = BuildConfig.DEFAULT_BASE_URL;
                String cookie = CookieManager.getInstance().getCookie(base);
                if (cookie == null || cookie.isEmpty()) {
                    Log.i(TAG, "no cookie yet, skip sync");
                    NfcCardService.setCardUrl(appContext, null);
                    return;
                }
                HttpURLConnection connection = (HttpURLConnection) new URL(base + "/api/me/nfc-card").openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Cookie", cookie);
                connection.setRequestProperty("Accept", "application/json");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                int code = connection.getResponseCode();
                if (code != 200) {
                    Log.i(TAG, "sync http " + code);
                    NfcCardService.setCardUrl(appContext, null);
                    return;
                }
                String body = readAll(connection.getInputStream());
                JSONObject json = new JSONObject(body);
                boolean enabled = json.optBoolean("enabled", false);
                String url = enabled ? json.optString("url", null) : null;
                Log.i(TAG, "sync ok, enabled=" + enabled);
                NfcCardService.setCardUrl(appContext, url == null || url.isEmpty() ? null : url);
            } catch (Exception cause) {
                Log.w(TAG, "sync failed: " + cause);
                NfcCardService.setCardUrl(appContext, null);
            }
        }, "nfc-card-sync").start();
    }

    private static String readAll(InputStream stream) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }
}
