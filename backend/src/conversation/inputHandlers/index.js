import * as shortText from "./shortText.js";
import * as singleSelect from "./singleSelect.js";
import * as imageUrl from "./imageUrl.js";
import * as location from "./location.js";
import * as date from "./date.js";
import * as time from "./time.js";
import * as yesNo from "./yesNo.js";
import * as positiveInt from "./positiveInt.js";
import * as price from "./price.js";
import * as youtubeUrl from "./youtubeUrl.js";
import * as url from "./url.js";
import * as functionCard from "./functionCard.js";
import * as functionsList from "./functionsList.js";
import * as dateRange from "./dateRange.js";
import * as weekdays from "./weekdays.js";
import * as timeRangeList from "./timeRangeList.js";
import * as functionsSummary from "./functionsSummary.js";

// Registro de InputHandlers por inputType. Agregar un tipo de dato nuevo
// (voz transcripta, adjunto, etc.) es sumar una entrada acá — el
// EventCreationEngine y los StepDefinitions no cambian (OCP).
export const INPUT_HANDLERS = {
    SHORT_TEXT: shortText,
    SINGLE_SELECT: singleSelect,
    IMAGE_URL: imageUrl,
    LOCATION: location,
    DATE: date,
    TIME: time,
    YES_NO: yesNo,
    POSITIVE_INT: positiveInt,
    PRICE: price,
    YOUTUBE_URL: youtubeUrl,
    URL: url,
    FUNCTION_CARD: functionCard,
    FUNCTIONS_LIST: functionsList,
    DATE_RANGE: dateRange,
    WEEKDAYS: weekdays,
    TIME_RANGE_LIST: timeRangeList,
    FUNCTIONS_SUMMARY: functionsSummary,
};

export function getInputHandler(inputType) {
    const handler = INPUT_HANDLERS[inputType];
    if (!handler) {
        throw new Error(`UNKNOWN_INPUT_TYPE: ${inputType}`);
    }
    return handler;
}
