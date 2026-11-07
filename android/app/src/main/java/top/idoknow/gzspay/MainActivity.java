package top.idoknow.gzspay;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

/**
 * 应用外壳：用 WebView 打开 gzspay，加上本地缓存与 UA 标识，进出前后台时做应用锁。
 * 客户端专属的入口（应用锁设置、刷新 NFC）由网页通过 {@code window.GzspayClient} 调过来，
 * 这样界面上不额外盖一个悬浮按钮。
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_UNLOCK = 1001;
    private static final long NFC_SYNC_INTERVAL_MS = 30_000L;

    private WebView webView;
    private boolean waitingUnlock = false;

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
            }
        });
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.addJavascriptInterface(new ClientBridge(), "GzspayClient");
        setContentView(webView);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(BuildConfig.DEFAULT_BASE_URL);
        }
        requestUnlockIfNeeded();
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
        handler.removeCallbacks(nfcTick);
        handler.postDelayed(nfcTick, NFC_SYNC_INTERVAL_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(nfcTick);
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
        public void openLockSetup() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, LockSetupActivity.class)));
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
