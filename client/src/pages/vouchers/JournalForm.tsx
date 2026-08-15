import { JournalFormView } from "./journalform/JournalFormView";
import { useJournalFormModel } from "./journalform/useJournalFormModel";
import type { JournalFormProps } from "./journalform/types";

export function JournalForm(props: JournalFormProps) {
  const model = useJournalFormModel(props);
  return <JournalFormView model={model} />;
}
