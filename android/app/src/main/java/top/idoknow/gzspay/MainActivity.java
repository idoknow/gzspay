package top.idoknow.gzspay;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.util.Arrays;

/**
 * 应用外壳：用 WebView 打开 gzspay，加上本地缓存与 UA 标识，进出前后台时做应用锁。
 * 客户端专属的入口（应用锁设置、刷新 NFC）由网页通过 {@code window.GzspayClient} 调过来，
 * 这样界面上不额外盖一个悬浮按钮。
 */
public class MainActivity extends AppCompatActivity implements NfcAdapter.ReaderCallback {

    private static final int REQUEST_UNLOCK = 1001;
    private static final int REQUEST_NOTIFICATIONS = 1002;
    private static final int REQUEST_CAMERA = 1003;
    private static final long NFC_SYNC_INTERVAL_MS = 30_000L;

    private WebView webView;
    private boolean waitingUnlock = false;
    private NfcAdapter nfcAdapter;
    private boolean nfcReading = false;
    private boolean nfcReadRequested = false;
    private String pendingPushUrl = null;

    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable nfcTick = new Runnable() {
        @Override
        public void run() {
            NfcCardSync.refresh(MainActivity.this);
            handler.postDelayed(this, NFC_SYNC_INTERVAL_MS);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        PushNotifications.ensureChannel(this);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " GzspayApp/" + BuildConfig.VERSION_NAME);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (scheme != null && (scheme.equals("http") || scheme.equals("https"))) {
                    return false;
                }
                // alipays:// 之类的深度链接交给系统处理
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // 没有安装对应的应用
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                NfcCardSync.refresh(MainActivity.this);
                loadPushToken();
                if (pendingPushUrl != null) {
                    String target = pendingPushUrl;
                    pendingPushUrl = null;
                    webView.loadUrl(BuildConfig.DEFAULT_BASE_URL + target);
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean wantsCamera = Arrays.asList(request.getResources())
                        .contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                if (wantsCamera && ContextCompat.checkSelfPermission(
                        MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                } else {
                    // 相机权限由「设置 → 权限与通知」或首次扫码时请求；未授权时先拒绝
                    request.deny();
                }
            }
        });
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.addJavascriptInterface(new ClientBridge(), "GzspayClient");
        setContentView(webView);

        pendingPushUrl = pushUrlOf(getIntent());
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(BuildConfig.DEFAULT_BASE_URL);
        }
        requestStartupPermissions();
        requestUnlockIfNeeded();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = pushUrlOf(intent);
        if (url != null && webView != null) {
            webView.loadUrl(BuildConfig.DEFAULT_BASE_URL + url);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_NOTIFICATIONS) {
            loadPushToken();
        }
    }

    /** 通知里带的跳转地址只接受站内路径，避免被塞进外部链接 */
    private String pushUrlOf(Intent intent) {
        if (intent == null) return null;
        String url = intent.getStringExtra(PushNotifications.EXTRA_URL);
        intent.removeExtra(PushNotifications.EXTRA_URL);
        if (url == null) return null;
        String trimmed = url.trim();
        if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
        return trimmed;
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
    }

    /** 进入应用时把运行时权限一次问齐；权限页仍可单独补授权 */
    private void requestStartupPermissions() {
        java.util.List<String> missing = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(
                    this, missing.toArray(new String[0]), REQUEST_NOTIFICATIONS);
        }
    }

    private void loadPushToken() {
        String cached = PushStore.token(this);
        if (!cached.isEmpty()) {
            deliverPushToken(cached);
            return;
        }
        if (FirebaseApp.getApps(this).isEmpty()) {
            return;
        }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            String token = task.isSuccessful() ? task.getResult() : null;
            if (token == null || token.isEmpty()) return;
            PushStore.saveToken(this, token);
            deliverPushToken(token);
        });
    }

    private void deliverPushToken(String token) {
        if (webView == null || token == null || token.isEmpty()) return;
        webView.evaluateJavascript(
                "window.__gzspayPushToken && window.__gzspayPushToken("
                        + JSONObject.quote(token) + ")", null);
    }

    private boolean startNfcRead() {
        if (nfcAdapter == null || !nfcAdapter.isEnabled()) return false;
        Bundle options = new Bundle();
        options.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250);
        nfcAdapter.enableReaderMode(this, this,
                NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B
                        | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V
                        | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
                options);
        nfcReading = true;
        nfcReadRequested = true;
        return true;
    }

    /** 只关读卡、保留网页的「正在读取」意图，回到前台后继续 */
    private void pauseNfcRead() {
        if (nfcAdapter != null && nfcReading) {
            try {
                nfcAdapter.disableReaderMode(this);
            } catch (Exception ignored) {
                // 页面切换时重复停止不当作错误
            }
        }
        nfcReading = false;
    }

    private void stopNfcRead() {
        pauseNfcRead();
        nfcReadRequested = false;
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        if (!nfcReading) return;
        Ndef ndef = Ndef.get(tag);
        if (ndef == null) return;
        String cardText = null;
        try {
            ndef.connect();
            NdefMessage message = ndef.getNdefMessage();
            if (message != null) {
                for (NdefRecord record : message.getRecords()) {
                    if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN
                            && Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                        String text = NdefTextParser.parseText(record.getPayload());
                        if (text != null) {
                            cardText = text;
                            break;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // 标签中途移开或不是 NDEF 卡
        } finally {
            try {
                ndef.close();
            } catch (Exception ignored) {
                // 忽略
            }
        }
        if (cardText == null) return;
        final String value = cardText;
        runOnUiThread(() -> {
            stopNfcRead();
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.__gzspayNfcRead && window.__gzspayNfcRead("
                                + JSONObject.quote(value) + ")", null);
            }
        });
    }

    private void requestUnlockIfNeeded() {
        if (waitingUnlock) {
            return;
        }
        if (LockStore.needsUnlock(this)) {
            waitingUnlock = true;
            startActivityForResult(new Intent(this, LockActivity.class), REQUEST_UNLOCK);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_UNLOCK) {
            waitingUnlock = false;
            if (resultCode != RESULT_OK) {
                // 没有解锁就退出，避免绕过应用锁继续浏览
                finish();
            } else {
                NfcCardSync.refresh(this);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        requestUnlockIfNeeded();
        NfcCardSync.refresh(this);
        if (nfcReadRequested) startNfcRead();
        loadPushToken();
        handler.removeCallbacks(nfcTick);
        handler.postDelayed(nfcTick, NFC_SYNC_INTERVAL_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(nfcTick);
        pauseNfcRead();
        LockStore.onAppBackground();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(nfcTick);
        stopNfcRead();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** 网页里的 window.GzspayClient：客户端专属能力，只在装了客户端的手机上有。 */
    private final class ClientBridge {

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public boolean nfcReady() {
            return NfcCardService.getCardUrl() != null;
        }

        @JavascriptInterface
        public void refreshNfc() {
            NfcCardSync.refresh(MainActivity.this);
        }

        @JavascriptInterface
        public String lockStatus() {
            int type = LockStore.getType(MainActivity.this);
            String name = type == LockStore.TYPE_PIN4 ? "pin4"
                    : type == LockStore.TYPE_PIN6 ? "pin6"
                    : type == LockStore.TYPE_PATTERN ? "pattern" : "none";
            boolean available = BiometricManager.from(MainActivity.this)
                    .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                    == BiometricManager.BIOMETRIC_SUCCESS;
            try {
                JSONObject status = new JSONObject();
                status.put("type", name);
                status.put("biometricEnabled", LockStore.isBiometricEnabled(MainActivity.this));
                status.put("biometricAvailable", available);
                return status.toString();
            } catch (Exception cause) {
                return "{\"type\":\"none\",\"biometricEnabled\":false,\"biometricAvailable\":false}";
            }
        }

        @JavascriptInterface
        public boolean saveLock(String type, String code) {
            if (type == null || code == null) return false;
            int kind;
            if ("pin4".equals(type)) {
                if (!code.matches("\\d{4}")) return false;
                kind = LockStore.TYPE_PIN4;
            } else if ("pin6".equals(type)) {
                if (!code.matches("\\d{6}")) return false;
                kind = LockStore.TYPE_PIN6;
            } else if ("pattern".equals(type)) {
                if (!code.matches("\\d(-\\d){3,8}")) return false;
                kind = LockStore.TYPE_PATTERN;
            } else {
                return false;
            }
            LockStore.saveCode(MainActivity.this, kind, code);
            return true;
        }

        @JavascriptInterface
        public void clearLock() {
            LockStore.clear(MainActivity.this);
        }

        @JavascriptInterface
        public boolean setBiometric(boolean enabled) {
            LockStore.setBiometricEnabled(MainActivity.this, enabled);
            return true;
        }

        @JavascriptInterface
        public boolean startNfcRead() {
            boolean available = nfcAdapter != null && nfcAdapter.isEnabled();
            if (available) {
                runOnUiThread(() -> MainActivity.this.startNfcRead());
            }
            return available;
        }

        @JavascriptInterface
        public void stopNfcRead() {
            runOnUiThread(MainActivity.this::stopNfcRead);
        }

        @JavascriptInterface
        public String pushToken() {
            return PushStore.token(MainActivity.this);
        }

        @JavascriptInterface
        public boolean notificationsEnabled() {
            return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
        }

        @JavascriptInterface
        public void requestNotifications() {
            runOnUiThread(MainActivity.this::requestNotificationPermission);
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> {
                try {
                    Intent intent;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                .setData(Uri.parse("package:" + getPackageName()));
                    }
                    startActivity(intent);
                } catch (Exception ignored) {
                    // 系统设置页打不开时保持静默
                }
            });
        }

        @JavascriptInterface
        public boolean cameraEnabled() {
            return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestCamera() {
            runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this,
                    new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA));
        }

        @JavascriptInterface
        public boolean nfcEnabled() {
            return nfcAdapter != null && nfcAdapter.isEnabled();
        }

        @JavascriptInterface
        public void openNfcSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_NFC_SETTINGS));
                } catch (Exception ignored) {
                    // 没有 NFC 设置页时保持静默
                }
            });
        }

        @JavascriptInterface
        public void goHome() {
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.loadUrl(BuildConfig.DEFAULT_BASE_URL + "/me");
                }
            });
        }
    }
}
