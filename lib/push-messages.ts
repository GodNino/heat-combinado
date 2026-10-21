// What each phone notification says, in the language the person chose (migration 039 keeps it per
// device). Short enough for a lock screen: a title and one line.
export const PUSH_EVENTS = ["preshift_posted", "study_assigned", "urgent_report", "retake_requested", "schedule_published", "time_off_requested", "time_off_decided",
  "shift_released", "shift_offered", "shift_change_pending", "shift_change_declined", "shift_change_decided"] as const;
export type PushEvent = typeof PUSH_EVENTS[number];

const MESSAGES: Record<PushEvent, Record<"en" | "es", (place: string) => {title: string; body: string}>> = {
  preshift_posted: {
    en: place => ({title: "Pre-shift is up", body: `Today's board at ${place} is posted. Read it before service.`}),
    es: place => ({title: "Ya está el pre-turno", body: `El pre-turno de hoy en ${place} está publicado. Léelo antes del servicio.`}),
  },
  study_assigned: {
    en: place => ({title: "New dishes to study", body: `Your manager at ${place} assigned you dishes to study.`}),
    es: place => ({title: "Tienes platos para estudiar", body: `Tu manager en ${place} te asignó platos para estudiar.`}),
  },
  urgent_report: {
    en: place => ({title: "Urgent shift report", body: `${place}: an allergy incident or injury was reported. Open the report in HEAT.`}),
    es: place => ({title: "Reporte de turno urgente", body: `${place}: se reportó un incidente de alergia o una lesión. Abre el reporte en HEAT.`}),
  },
  schedule_published: {
    en: place => ({title: "Your schedule is out", body: `New or changed shifts at ${place}. Open HEAT to see them.`}),
    es: place => ({title: "Salió tu horario", body: `Hay turnos nuevos o cambios en ${place}. Abre HEAT para verlos.`}),
  },
  time_off_requested: {
    en: place => ({title: "Time off request", body: `Someone at ${place} asked for time off. Approve it in Schedule.`}),
    es: place => ({title: "Solicitud de día libre", body: `Alguien en ${place} pidió un día libre. Apruébalo en Horario.`}),
  },
  time_off_decided: {
    en: place => ({title: "Time off answered", body: `Your manager at ${place} answered your time off request.`}),
    es: place => ({title: "Respondieron tu día libre", body: `Tu manager en ${place} respondió tu solicitud de día libre.`}),
  },
  shift_released: {
    en: place => ({title: "A shift is up for grabs", body: `Someone in your position at ${place} can't make a shift. Take it in Schedule.`}),
    es: place => ({title: "Hay un turno disponible", body: `Alguien de tu puesto en ${place} no puede ir a un turno. Tómalo en Horario.`}),
  },
  shift_offered: {
    en: place => ({title: "Can you cover a shift?", body: `A coworker at ${place} asked you to cover or swap a shift. Answer in Schedule.`}),
    es: place => ({title: "¿Puedes cubrir un turno?", body: `Un compañero en ${place} te pidió cubrir o cambiar un turno. Responde en Horario.`}),
  },
  shift_change_pending: {
    en: place => ({title: "Shift change to approve", body: `A shift change at ${place} is waiting for a manager. Open Schedule.`}),
    es: place => ({title: "Cambio de turno por aprobar", body: `Un cambio de turno en ${place} espera a un manager. Abre Horario.`}),
  },
  shift_change_declined: {
    en: place => ({title: "They can't cover it", body: `Your coworker at ${place} said no to your shift. The shift is still yours.`}),
    es: place => ({title: "No pueden cubrirlo", body: `Tu compañero en ${place} dijo que no. El turno sigue siendo tuyo.`}),
  },
  shift_change_decided: {
    en: place => ({title: "Shift change answered", body: `Your manager at ${place} answered a shift change. Check your shifts.`}),
    es: place => ({title: "Respondieron un cambio de turno", body: `Tu manager en ${place} respondió un cambio de turno. Revisa tus turnos.`}),
  },
  retake_requested: {
    en: place => ({title: "Quiz retake request", body: `Someone at ${place} asked for another quiz attempt. Approve it from Home.`}),
    es: place => ({title: "Piden otro intento de quiz", body: `Alguien en ${place} pidió otro intento de quiz. Apruébalo desde Inicio.`}),
  },
};

export function pushMessage(event: PushEvent, lang: string, place: string) {
  const words = MESSAGES[event][lang === "es" ? "es" : "en"](place || "HEAT");
  return {...words, url: "/app", tag: event};
}
