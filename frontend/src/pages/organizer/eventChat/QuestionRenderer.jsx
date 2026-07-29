import TextAnswer from "./answerInputs/TextAnswer.jsx";
import TextareaAnswer from "./answerInputs/TextareaAnswer.jsx";
import SingleSelectCards from "./answerInputs/SingleSelectCards.jsx";
import ImageAnswer from "./answerInputs/ImageAnswer.jsx";
import LocationAnswer from "./answerInputs/LocationAnswer.jsx";
import DateAnswer from "./answerInputs/DateAnswer.jsx";
import TimeAnswer from "./answerInputs/TimeAnswer.jsx";
import YesNoAnswer from "./answerInputs/YesNoAnswer.jsx";
import NumberAnswer from "./answerInputs/NumberAnswer.jsx";
import YoutubeAnswer from "./answerInputs/YoutubeAnswer.jsx";
import UrlAnswer from "./answerInputs/UrlAnswer.jsx";
import FunctionCardAnswer from "./answerInputs/FunctionCardAnswer.jsx";
import FunctionsListAnswer from "./answerInputs/FunctionsListAnswer.jsx";
import DateRangeAnswer from "./answerInputs/DateRangeAnswer.jsx";
import WeekdaysAnswer from "./answerInputs/WeekdaysAnswer.jsx";
import FunctionsRecurringSchedulesAnswer from "./answerInputs/FunctionsRecurringSchedulesAnswer.jsx";
import FunctionsSummaryAnswer from "./answerInputs/FunctionsSummaryAnswer.jsx";
import { getCategoryIcon } from "./categoryIcons.js";
import { getSocialNetworkIcon } from "../../../lib/socialNetworkIcons.js";

// Registro inputType -> componente. Agregar un inputType nuevo del backend
// es sumar una entrada acá, sin tocar ConversationView.jsx (OCP).
const RENDERERS = {
  SHORT_TEXT: TextAnswer,
  SINGLE_SELECT: SingleSelectCards,
  IMAGE_URL: ImageAnswer,
  LOCATION: LocationAnswer,
  DATE: DateAnswer,
  TIME: TimeAnswer,
  YES_NO: YesNoAnswer,
  POSITIVE_INT: NumberAnswer,
  PRICE: NumberAnswer,
  YOUTUBE_URL: YoutubeAnswer,
  URL: UrlAnswer,
  FUNCTION_CARD: FunctionCardAnswer,
  FUNCTIONS_LIST: FunctionsListAnswer,
  DATE_RANGE: DateRangeAnswer,
  WEEKDAYS: WeekdaysAnswer,
  TIME_RANGE_LIST: FunctionsRecurringSchedulesAnswer,
  FUNCTIONS_SUMMARY: FunctionsSummaryAnswer,
};

// Excepciones puntuales donde el mismo inputType necesita un componente o
// props distintas según el paso (ej: DESCRIPTION es SHORT_TEXT pero pide
// textarea; CATEGORY y SOCIAL_NETWORK son ambos SINGLE_SELECT pero con
// íconos distintos).
const STEP_COMPONENT_OVERRIDES = {
  DESCRIPTION: TextareaAnswer,
};

function extraPropsFor(stepId, context) {
  if (stepId === "CATEGORY") return { getIcon: getCategoryIcon };
  if (stepId === "SOCIAL_NETWORK") return { getIcon: getSocialNetworkIcon };
  if (stepId === "SOCIAL_URL") return { network: context.lastSocialNetwork };
  return {};
}

export default function QuestionRenderer({ prompt, onSubmit, disabled, context }) {
  const Component = STEP_COMPONENT_OVERRIDES[prompt.stepId] ?? RENDERERS[prompt.inputType];

  if (!Component) {
    return (
      <p className="text-sm text-rose-400">
        No sé cómo mostrar el paso "{prompt.stepId}" ({prompt.inputType}).
      </p>
    );
  }

  return (
    <Component
      {...prompt}
      onSubmit={onSubmit}
      disabled={disabled}
      {...extraPropsFor(prompt.stepId, context ?? {})}
    />
  );
}
