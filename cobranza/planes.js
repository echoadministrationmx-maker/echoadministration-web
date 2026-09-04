// Echo Administración — configuración central de regularización
// Esta lógica calcula propuestas. NO crea convenios ni modifica saldos.

window.ECHO_PLANES = {
  cuotaOrdinaria: 515,
  planes: [
    { id: 'rapido', nombre: 'Echo Rápido', meses: 3, recomendado: false },
    { id: 'regulariza', nombre: 'Echo Regulariza', meses: 6, recomendado: true },
    { id: 'flexible', nombre: 'Echo Flexible', meses: 12, recomendado: false }
  ],
  calcular(adeudo, cuota = 515) {
    const saldo = Math.max(0, Number(adeudo) || 0);
    const cuotaActual = Math.max(0, Number(cuota) || this.cuotaOrdinaria);
    return this.planes.map(plan => {
      const abonoDeuda = Math.ceil((saldo / plan.meses) * 100) / 100;
      const totalMensual = Math.ceil((abonoDeuda + cuotaActual) * 100) / 100;
      return {
        ...plan,
        adeudo: saldo,
        cuotaCorriente: cuotaActual,
        abonoDeuda,
        totalMensual,
        totalQuincenal: Math.ceil((totalMensual / 2) * 100) / 100
      };
    });
  },
  social(adeudo, abonoDeuda, cuota = 515) {
    const saldo = Math.max(0, Number(adeudo) || 0);
    const abono = Math.max(0, Number(abonoDeuda) || 0);
    const cuotaActual = Math.max(0, Number(cuota) || this.cuotaOrdinaria);
    return {
      id: 'social', nombre: 'Echo Social', adeudo: saldo,
      cuotaCorriente: cuotaActual, abonoDeuda: abono,
      totalMensual: cuotaActual + abono,
      totalQuincenal: Math.ceil(((cuotaActual + abono) / 2) * 100) / 100,
      requiereAprobacion: true
    };
  }
};
