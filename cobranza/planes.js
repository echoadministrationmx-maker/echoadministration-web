// Echo Administración — configuración central de regularización
// Esta lógica calcula propuestas. NO crea convenios ni modifica saldos.

window.ECHO_PLANES = {
  cuotaOrdinaria: 515,
  descuentosPorAntiguedad: [
    { mesesMinimos: 13, porcentaje: 20 },
    { mesesMinimos: 7, porcentaje: 10 },
    { mesesMinimos: 0, porcentaje: 0 }
  ],
  planes: [
    { id: 'rapido', nombre: 'Echo Rápido', meses: 3, recomendado: false },
    { id: 'regulariza', nombre: 'Echo Regulariza', meses: 6, recomendado: true },
    { id: 'flexible', nombre: 'Echo Flexible', meses: 12, recomendado: false }
  ],
  obtenerDescuento(mesesVencidos) {
    const meses = Math.max(0, Number(mesesVencidos) || 0);
    const regla = this.descuentosPorAntiguedad.find(r => meses >= r.mesesMinimos);
    return regla ? regla.porcentaje : 0;
  },
  calcular(adeudoHistorico, mesesVencidos = 0, cuota = 515) {
    const saldoOriginal = Math.max(0, Number(adeudoHistorico) || 0);
    const cuotaActual = Math.max(0, Number(cuota) || this.cuotaOrdinaria);
    const descuentoPct = this.obtenerDescuento(mesesVencidos);
    const descuentoMonto = Math.round((saldoOriginal * descuentoPct)) / 100;
    const saldoConDescuento = Math.max(0, Math.round((saldoOriginal - descuentoMonto) * 100) / 100);

    return this.planes.map(plan => {
      const abonoDeuda = Math.ceil((saldoConDescuento / plan.meses) * 100) / 100;
      const totalMensual = Math.ceil((abonoDeuda + cuotaActual) * 100) / 100;
      return {
        ...plan,
        mesesVencidos: Math.max(0, Number(mesesVencidos) || 0),
        adeudoOriginal: saldoOriginal,
        descuentoPct,
        descuentoMonto,
        adeudoConDescuento: saldoConDescuento,
        cuotaCorriente: cuotaActual,
        abonoDeuda,
        totalMensual,
        totalQuincenal: Math.ceil((totalMensual / 2) * 100) / 100
      };
    });
  },
  social(adeudoHistorico, mesesVencidos, abonoDeuda, cuota = 515) {
    const saldoOriginal = Math.max(0, Number(adeudoHistorico) || 0);
    const descuentoPct = this.obtenerDescuento(mesesVencidos);
    const descuentoMonto = Math.round((saldoOriginal * descuentoPct)) / 100;
    const saldoConDescuento = Math.max(0, Math.round((saldoOriginal - descuentoMonto) * 100) / 100);
    const abono = Math.max(0, Number(abonoDeuda) || 0);
    const cuotaActual = Math.max(0, Number(cuota) || this.cuotaOrdinaria);
    return {
      id: 'social', nombre: 'Echo Social',
      mesesVencidos: Math.max(0, Number(mesesVencidos) || 0),
      adeudoOriginal: saldoOriginal,
      descuentoPct,
      descuentoMonto,
      adeudoConDescuento: saldoConDescuento,
      cuotaCorriente: cuotaActual,
      abonoDeuda: abono,
      totalMensual: cuotaActual + abono,
      totalQuincenal: Math.ceil(((cuotaActual + abono) / 2) * 100) / 100,
      requiereAprobacion: true
    };
  }
};
