package top.idoknow.gzspay;

import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;

/**
 * 应用锁设置：四/六位数字密码、手势图案，以及是否允许指纹 / 人脸解锁。
 */
public class LockSetupActivity extends AppCompatActivity {

    private TextView statusView;
    private CheckBox biometricBox;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFF6F7FB);
        root.setPadding(dp(20), dp(28), dp(20), dp(28));

        TextView title = new TextView(this);
        title.setText("应用锁");
        title.setTextSize(20f);
        title.setTextColor(0xFF0F172A);
        root.addView(title);

        statusView = new TextView(this);
        statusView.setTextSize(12.5f);
        statusView.setTextColor(0xFF64748B);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = dp(6);
        root.addView(statusView, statusParams);

        addOption(root, "四位数密码", view -> setPin(LockStore.TYPE_PIN4));
        addOption(root, "六位数密码", view -> setPin(LockStore.TYPE_PIN6));
        addOption(root, "手势密码", view -> setPattern());

        biometricBox = new CheckBox(this);
        biometricBox.setText("允许用指纹 / 人脸解锁");
        biometricBox.setTextSize(14f);
        LinearLayout.LayoutParams boxParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        boxParams.topMargin = dp(16);
        bio_check:
        {
            boolean supported = BiometricManager.from(this)
                    .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                    == BiometricManager.BIOMETRIC_SUCCESS;
            biometricBox.setEnabled(supported);
            if (!supported) {
                biometricBox.setText("这台设备没有可用的指纹或人脸");
            }
            biometricBox.setOnCheckedChangeListener((button, checked) ->
                    LockStore.setBiometricEnabled(this, checked));
            root.addView(biometricBox, boxParams);
        }

        addOption(root, "关闭应用锁", view -> new AlertDialog.Builder(this)
                .setTitle("关闭应用锁")
                .setMessage("关闭后打开 gzspay 不再需要验证。")
                .setNegativeButton("取消", null)
                .setPositiveButton("关闭", (dialog, which) -> {
                    LockStore.clear(this);
                    refresh();
                    toast("应用锁已关闭");
                })
                .show());

        setContentView(root);
    }

    private void addOption(LinearLayout root, String label, android.view.View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        params.topMargin = dp(12);
        root.addView(button, params);
    }

    private void refresh() {
        int type = LockStore.getType(this);
        String text;
        if (type == LockStore.TYPE_PIN4) {
            text = "已开启：四位数密码";
        } else if (type == LockStore.TYPE_PIN6) {
            text = "已开启：六位数密码";
        } else if (type == LockStore.TYPE_PATTERN) {
            text = "已开启：手势密码";
        } else {
            text = "未开启。开启后每次打开应用都需要验证。";
        }
        statusView.setText(text);
        if (biometricBox != null) {
            biometricBox.setChecked(LockStore.isBiometricEnabled(this));
            biometricBox.setEnabled(type != LockStore.TYPE_NONE && isBiometricSupported());
        }
    }

    private boolean isBiometricSupported() {
        return BiometricManager.from(this)
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private void setPin(int type) {
        int length = type == LockStore.TYPE_PIN6 ? 6 : 4;
        askPin(length, null);
    }

    private void askPin(int length, String first) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        input.setHint(length + " 位数字");
        new AlertDialog.Builder(this)
                .setTitle(first == null ? "设置 " + length + " 位数字密码" : "再输入一次")
                .setView(input)
                .setNegativeButton("取消", null)
                .setPositiveButton("确定", (dialog, which) -> {
                    String code = input.getText().toString().trim();
                    if (code.length() != length) {
                        toast("请输入 " + length + " 位数字");
                        return;
                    }
                    if (first == null) {
                        askPin(length, code);
                        return;
                    }
                    if (!first.equals(code)) {
                        toast("两次输入不一致，请重新设置");
                        return;
                    }
                    LockStore.saveCode(this, length, code);
                    refresh();
                    toast("应用锁已开启");
                })
                .show();
    }

    private void setPattern() {
        askPattern(null);
    }

    private void askPattern(String first) {
        PatternView view = new PatternView(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(280), dp(280));
        LinearLayout wrap = new LinearLayout(this);
        wrap.setGravity(Gravity.CENTER);
        wrap.addView(view, params);
        final String[] collected = new String[]{null};
        view.setListener(new PatternView.Listener() {
            @Override
            public void onPatternComplete(String signature) {
                collected[0] = signature;
            }

            @Override
            public void onPatternStart() {
                collected[0] = null;
            }
        });
        new AlertDialog.Builder(this)
                .setTitle(first == null ? "画一个手势密码" : "再画一次")
                .setView(wrap)
                .setNegativeButton("取消", null)
                .setPositiveButton("确定", (dialog, which) -> {
                    String code = collected[0];
                    if (code == null) {
                        toast("请至少连接 4 个点");
                        return;
                    }
                    if (first == null) {
                        askPattern(code);
                        return;
                    }
                    if (!first.equals(code)) {
                        toast("两次手势不一致，请重新设置");
                        return;
                    }
                    LockStore.saveCode(this, LockStore.TYPE_PATTERN, code);
                    refresh();
                    toast("手势密码已开启");
                })
                .show();
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}
