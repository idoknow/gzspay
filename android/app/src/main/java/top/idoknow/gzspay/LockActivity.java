package top.idoknow.gzspay;

import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import java.util.concurrent.Executor;

/**
 * 解锁界面：四/六位数字密码、手势图案，或者系统指纹 / 人脸。
 */
public class LockActivity extends AppCompatActivity {

    public static final String EXTRA_REASON = "reason";

    private int type = LockStore.TYPE_NONE;
    private int pinLength = 4;
    private final StringBuilder entered = new StringBuilder();

    private TextView titleView;
    private TextView hintView;
    private LinearLayout dotsRow;
    private LinearLayout keypad;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        type = LockStore.getType(this);
        if (type == LockStore.TYPE_NONE) {
            finishUnlocked();
            return;
        }
        pinLength = type == LockStore.TYPE_PIN6 ? 6 : 4;
        buildUi();
        maybePromptBiometric();
    }

    private void finishUnlocked() {
        LockStore.unlockNow();
        setResult(RESULT_OK);
        finish();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(0xFFF6F7FB);
        root.setPadding(dp(24), dp(48), dp(24), dp(28));

        titleView = new TextView(this);
        titleView.setText("解锁 gzspay");
        titleView.setTextSize(22f);
        titleView.setTextColor(0xFF0F172A);
        titleView.setGravity(Gravity.CENTER);
        root.addView(titleView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        hintView = new TextView(this);
        hintView.setText(type == LockStore.TYPE_PATTERN ? "画出手势密码" : "输入 " + pinLength + " 位数字密码");
        hintView.setTextSize(13f);
        hintView.setTextColor(0xFF64748B);
        hintView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintParams.topMargin = dp(8);
        root.addView(hintView, hintParams);

        if (type == LockStore.TYPE_PATTERN) {
            PatternView patternView = new PatternView(this);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(280), dp(280));
            params.topMargin = dp(28);
            root.addView(patternView, params);
            patternView.setListener(new PatternView.Listener() {
                @Override
                public void onPatternComplete(String signature) {
                    if (LockStore.verify(LockActivity.this, signature)) {
                        finishUnlocked();
                    } else {
                        patternView.showError();
                        hintView.setText("手势不对，再试一次");
                    }
                }

                @Override
                public void onPatternStart() {
                    hintView.setText("画出手势密码");
                }
            });
        } else {
            dotsRow = new LinearLayout(this);
            dotsRow.setOrientation(LinearLayout.HORIZONTAL);
            dotsRow.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams dotsParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            dotsParams.topMargin = dp(30);
            root.addView(dotsRow, dotsParams);

            keypad = new LinearLayout(this);
            keypad.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams keypadParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            keypadParams.topMargin = dp(24);
            root.addView(keypad, keypadParams);
            buildKeypad();
            refreshDots();
        }

        if (LockStore.isBiometricEnabled(this)) {
            Button biometric = new Button(this);
            biometric.setText("使用指纹 / 人脸解锁");
            biometric.setAllCaps(false);
            biometric.setOnClickListener(view -> maybePromptBiometric());
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
            params.topMargin = dp(20);
            root.addView(biometric, params);
        }

        setContentView(root);
    }

    private void buildKeypad() {
        String[] rows = {"1 2 3", "4 5 6", "7 8 9", "空 0 ⌫"};
        for (String row : rows) {
            LinearLayout line = new LinearLayout(this);
            line.setOrientation(LinearLayout.HORIZONTAL);
            line.setGravity(Gravity.CENTER);
            for (String label : row.split(" ")) {
                Button key = new Button(this);
                key.setText("⌫".equals(label) ? "⌫" : label);
                key.setTextSize(20f);
                key.setAllCaps(false);
                key.setBackgroundColor("空".equals(label) ? 0x00000000 : 0xFFFFFFFF);
                key.setEnabled(!"空".equals(label));
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(58), 1f);
                params.setMargins(dp(6), dp(6), dp(6), dp(6));
                key.setOnClickListener(view -> onKey(label));
                line.addView(key, params);
            }
            keypad.addView(line, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }

    private void onKey(String label) {
        if ("⌫".equals(label)) {
            if (entered.length() > 0) {
                entered.deleteCharAt(entered.length() - 1);
            }
            refreshDots();
            return;
        }
        if (entered.length() >= pinLength) {
            return;
        }
        entered.append(label);
        refreshDots();
        if (entered.length() == pinLength) {
            String code = entered.toString();
            if (LockStore.verify(this, code)) {
                finishUnlocked();
            } else {
                entered.setLength(0);
                refreshDots();
                hintView.setText("密码不对，再试一次");
                View root = getWindow().getDecorView();
                root.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
            }
        }
    }

    private void refreshDots() {
        if (dotsRow == null) {
            return;
        }
        dotsRow.removeAllViews();
        for (int index = 0; index < pinLength; index++) {
            View dot = new View(this);
            android.graphics.drawable.GradientDrawable shape = new android.graphics.drawable.GradientDrawable();
            shape.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            shape.setColor(index < entered.length() ? 0xFF2563EB : 0x00000000);
            shape.setStroke(dp(1.5f), index < entered.length() ? 0xFF2563EB : 0xFFCBD5E1);
            dot.setBackground(shape);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(12), dp(12));
            params.setMargins(dp(7), 0, dp(7), 0);
            dotsRow.addView(dot, params);
        }
    }

    private boolean biometricAvailable() {
        BiometricManager manager = BiometricManager.from(this);
        int result = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        return result == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private void maybePromptBiometric() {
        if (!LockStore.isBiometricEnabled(this) || !biometricAvailable()) {
            return;
        }
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt prompt = new BiometricPrompt(this, executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        finishUnlocked();
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        if (hintView != null) {
                            hintView.setText(errString);
                        }
                    }
                });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("解锁 gzspay")
                .setSubtitle("用指纹或人脸确认是你本人")
                .setNegativeButtonText("用密码")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                .build();
        prompt.authenticate(info);
    }
}
