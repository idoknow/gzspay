package top.idoknow.gzspay;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** 通知渠道与本地通知展示：FCM 前台消息、后台通知都走这里。 */
public final class PushNotifications {

    public static final String CHANNEL_ID = "gzspay_default";
    public static final String EXTRA_URL = "push_url";

    private PushNotifications() {
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "交易与工单通知", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("收款请求、订单状态与工单消息");
        manager.createNotificationChannel(channel);
    }

    public static void show(Context context, String title, String body, String url) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(context);

        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (url != null && !url.isEmpty()) {
            intent.putExtra(EXTRA_URL, url);
        }
        PendingIntent pending = PendingIntent.getActivity(
                context,
                url == null ? 0 : url.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String safeTitle = title == null || title.trim().isEmpty() ? "gzspay" : title.trim();
        String safeBody = body == null ? "" : body.trim();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pending);
        NotificationManagerCompat.from(context).notify(
                (int) (System.currentTimeMillis() & 0x7FFFFFFF), builder.build());
    }
}
