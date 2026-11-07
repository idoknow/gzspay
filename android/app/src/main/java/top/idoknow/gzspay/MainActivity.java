package top.idoknow.gzspay;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

/**
 * 应用外壳：用 WebView 打开 gzspay，加上本地缓存与 UA 标识，进出前后台时做应用锁。
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_UNLOCK = 1001;
    private static final String LOCK_PAGE = "/unlock";

    private WebView webView;
    private boolean waitingUnlock = false;

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
    }

    @Override
    protected void onPause() {
        super.onPause();
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
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "应用锁设置");
        menu.add(0, 2, 1, "刷新 NFC 卡片");
        menu.add(0, 3, 2, "回到首页");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(@NonNull MenuItem item) {
        int id = item.getItemId();
        if (id == 1) {
            startActivity(new Intent(this, LockSetupActivity.class));
            return true;
        }
        if (id == 2) {
            NfcCardSync.refresh(this);
            android.widget.Toast.makeText(this, "已刷新 NFC 卡片状态", android.widget.Toast.LENGTH_SHORT).show();
            return true;
        }
        if (id == 3) {
            webView.loadUrl(BuildConfig.DEFAULT_BASE_URL + "/me");
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
