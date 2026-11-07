package top.idoknow.gzspay;

import android.content.Context;
import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;
import android.util.Log;

/**
 * 让这台手机像一张 NFC 标签：对方贴一贴，就读到一个指向 /nfc/&lt;token&gt; 的链接。
 * APDU 的处理逻辑在 {@link NfcApduHandler}（纯 Java，有单元测试），这里只负责接 Android 的 HCE。
 */
public class NfcCardService extends HostApduService {

    private static final String TAG = "gzspay-nfc";
    private static final String PREFS = "gzspay_nfc";
    private static final String KEY_URL = "card_url";

    private static volatile String cardUrl;

    private final NfcApduHandler handler = new NfcApduHandler();

    @Override
    public void onCreate() {
        super.onCreate();
        // 进程被杀后重启时先用手上缓存的一份，避免还没同步就被读到空卡
        cardUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, null);
        handler.setCardUrl(cardUrl);
        Log.i(TAG, "service ready, url " + (cardUrl == null ? "missing" : "cached"));
    }

    public static void setCardUrl(Context context, String url) {
        cardUrl = url;
        context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_URL, url)
                .apply();
        Log.i(TAG, "card url " + (url == null ? "cleared" : "updated"));
    }

    public static String getCardUrl() {
        return cardUrl;
    }

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        handler.setCardUrl(cardUrl);
        byte[] response = handler.process(apdu);
        if (response == null) {
            return NfcApduHandler.hex("6F00");
        }
        if (response.length >= 2 && cardUrl == null
                && apdu != null && apdu.length > 1 && (apdu[1] & 0xFF) == 0xB0) {
            Log.i(TAG, "reader asked for the card but no url synced yet");
        }
        return response;
    }

    @Override
    public void onDeactivated(int reason) {
        handler.reset();
    }
}
