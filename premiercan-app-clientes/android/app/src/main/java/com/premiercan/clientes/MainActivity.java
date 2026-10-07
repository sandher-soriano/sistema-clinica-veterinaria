package com.premiercan.clientes;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Acción que usa @capacitor/background-runner al tocar una de sus notificaciones
    private static final String ACCION_NOTIFICACION = ".NOTIFICATION_CLICKED";
    // Ver www/runners/promociones.js, ids de notificación:
    //   PromocionID                -> promoción nueva
    //   1000000 + PromocionID      -> "último día" de una promoción
    //   3000000 + PacienteID       -> recordatorio de vacuna / desparasitación
    //   4000000 + PacienteID       -> recordatorio de cita
    //   5000000 + RecordatorioID   -> aviso personalizado de la clínica
    private static final int OFFSET_ULTIMO_DIA = 1000000;
    private static final int OFFSET_PREVENTIVO = 3000000;
    private static final int OFFSET_CITA = 4000000;
    private static final int OFFSET_AVISO = 5000000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // App cerrada: se abrió tocando la notificación
        abrirPromocionSiCorresponde(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // App en segundo plano: se tocó la notificación
        abrirPromocionSiCorresponde(intent);
    }

    /** Si el intent viene de una de nuestras notificaciones, abre la pantalla que corresponde. */
    private void abrirPromocionSiCorresponde(Intent intent) {
        if (intent == null || !ACCION_NOTIFICACION.equals(intent.getAction())) return;
        int id = intent.getIntExtra("notificationId", -1);
        if (id <= 0) return;

        String ruta;
        if (id >= OFFSET_AVISO) {
            ruta = "/cliente/avisos.html";
        } else if (id >= OFFSET_CITA) {
            ruta = "/cliente/mis-citas.html";
        } else if (id >= OFFSET_PREVENTIVO) {
            ruta = "/cliente/mascota.html?id=" + (id - OFFSET_PREVENTIVO) + "&tab=esquemas";
        } else {
            int promocionId = id >= OFFSET_ULTIMO_DIA ? id - OFFSET_ULTIMO_DIA : id;
            ruta = "/cliente/promocion.html?id=" + promocionId;
        }

        Uri servidor = Uri.parse(getBridge().getConfig().getServerUrl());
        String url = servidor.getScheme() + "://" + servidor.getAuthority() + ruta;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
        // Que no se vuelva a procesar si la actividad se recrea (p. ej. al girar el celular)
        intent.setAction(Intent.ACTION_MAIN);
    }
}
