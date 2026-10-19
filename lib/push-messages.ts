// What each phone notification says, in the language the person chose (migration 039 keeps it per
// device). Short enough for a lock screen: a title and one line.
export const PUSH_EVENTS = ["preshift_posted", "study_assigned", "urgent_report", "retake_requested", "schedule_published", "time_off_requested", "time_off_decided"] as const;
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
  retake_requested: {
    en: place => ({title: "Quiz retake request", body: `Someone at ${place} asked for another quiz attempt. Approve it from Home.`}),
    es: place => ({title: "Piden otro intento de quiz", body: `Alguien en ${place} pidió otro intento de quiz. Apruébalo desde Inicio.`}),
  },
};

export function pushMessage(event: PushEvent, lang: string, place: string) {
  const words = MESSAGES[event][lang === "es" ? "es" : "en"](place || "HEAT");
  return {...words, url: "/app", tag: event};
}
