import { config } from "../../types";
import libwebrtc from "../webrtc/index";

export default class extends libwebrtc {

    constructor(opts: config) {
        super(opts);
    }


}
