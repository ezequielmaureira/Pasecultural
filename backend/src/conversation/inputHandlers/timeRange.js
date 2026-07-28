import { isValidTimeString } from "./time.js";

export function parse(rawValue) {
    const startTime = rawValue?.startTime;
    const endTime = rawValue?.endTime;

    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
        return { error: "Necesito hora de inicio y de fin en formato HH:mm." };
    }

    return { value: { startTime, endTime } };
}
