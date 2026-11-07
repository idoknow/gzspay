package top.idoknow.gzspay;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.List;

/**
 * 九宫格手势锁：连点至少 4 个点，返回 "0-1-2-5-8" 形式的签名。
 */
public class PatternView extends View {

    public interface Listener {
        void onPatternComplete(String signature);

        void onPatternStart();
    }

    private static final int MIN_DOTS = 4;

    private final Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path linePath = new Path();
    private final List<Integer> selected = new ArrayList<>();

    private float[] centersX = new float[9];
    private float[] centersY = new float[9];
    private float dotRadius = 0f;
    private float touchX = -1f;
    private float touchY = -1f;
    private boolean error = false;
    private Listener listener;

    public PatternView(Context context) {
        this(context, null);
    }

    public PatternView(Context context, AttributeSet attrs) {
        super(context, attrs);
        dotPaint.setStyle(Paint.Style.FILL);
        dotPaint.setColor(0xFFCBD5E1);
        ringPaint.setStyle(Paint.Style.STROKE);
        ringPaint.setStrokeWidth(dp(2f));
        ringPaint.setColor(0xFF94A3B8);
        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeWidth(dp(4f));
        linePaint.setStrokeCap(Paint.Cap.ROUND);
        linePaint.setColor(0xFF2563EB);
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public void showError() {
        error = true;
        invalidate();
        postDelayed(() -> {
            error = false;
            selected.clear();
            invalidate();
        }, 600L);
    }

    public void reset() {
        selected.clear();
        error = false;
        invalidate();
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
        int size = Math.min(getMeasuredWidth(), getMeasuredHeight());
        setMeasuredDimension(size, size);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        float step = Math.min(w, h) / 3f;
        dotRadius = step * 0.12f;
        for (int index = 0; index < 9; index++) {
            centersX[index] = step * (index % 3) + step / 2f;
            centersY[index] = step * (index / 3) + step / 2f;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int activeColor = error ? 0xFFDC2626 : 0xFF2563EB;
        ringPaint.setColor(error ? 0xFFDC2626 : 0xFF94A3B8);
        linePaint.setColor(activeColor);

        if (selected.size() > 1) {
            linePath.reset();
            float[] first = centerOf(selected.get(0));
            linePath.moveTo(first[0], first[1]);
            for (int index = 1; index < selected.size(); index++) {
                float[] point = centerOf(selected.get(index));
                linePath.lineTo(point[0], point[1]);
            }
            if (touchX >= 0 && touchY >= 0) {
                linePath.lineTo(touchX, touchY);
            }
            canvas.drawPath(linePath, linePaint);
        }

        for (int index = 0; index < 9; index++) {
            boolean picked = selected.contains(index);
            dotPaint.setColor(picked ? activeColor : 0xFFCBD5E1);
            canvas.drawCircle(centersX[index], centersY[index], dotRadius, dotPaint);
            if (picked) {
                canvas.drawCircle(centersX[index], centersY[index], dotRadius * 2.1f, ringPaint);
            }
        }
    }

    private float[] centerOf(int index) {
        return new float[]{centersX[index], centersY[index]};
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (!isEnabled()) {
            return false;
        }
        float x = event.getX();
        float y = event.getY();
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                selected.clear();
                error = false;
                touchX = x;
                touchY = y;
                if (listener != null) {
                    listener.onPatternStart();
                }
                addPointAt(x, y);
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                touchX = x;
                touchY = y;
                addPointAt(x, y);
                invalidate();
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                touchX = -1f;
                touchY = -1f;
                if (selected.size() >= MIN_DOTS) {
                    StringBuilder builder = new StringBuilder();
                    for (int index = 0; index < selected.size(); index++) {
                        if (index > 0) {
                            builder.append('-');
                        }
                        builder.append(selected.get(index));
                    }
                    if (listener != null) {
                        listener.onPatternComplete(builder.toString());
                    }
                } else {
                    selected.clear();
                }
                invalidate();
                return true;
            default:
                return super.onTouchEvent(event);
        }
    }

    private void addPointAt(float x, float y) {
        for (int index = 0; index < 9; index++) {
            float dx = x - centersX[index];
            float dy = y - centersY[index];
            if (dx * dx + dy * dy <= (dotRadius * 2.4f) * (dotRadius * 2.4f) && !selected.contains(index)) {
                selected.add(index);
                performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
                return;
            }
        }
    }
}
