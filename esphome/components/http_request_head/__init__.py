from esphome import automation
import esphome.config_validation as cv
from esphome.const import CONF_METHOD, CONF_URL
from esphome.components.http_request import (
    HTTP_REQUEST_ACTION_SCHEMA,
    HttpRequestSendAction,
    http_request_action_to_code,
)

DEPENDENCIES = ["http_request"]

CONFIG_SCHEMA = cv.Schema({})

HTTP_REQUEST_HEAD_ACTION_SCHEMA = automation.maybe_conf(
    CONF_URL,
    HTTP_REQUEST_ACTION_SCHEMA.extend(
        {
            cv.Optional(CONF_METHOD, default="HEAD"): cv.one_of("HEAD", upper=True),
        }
    ),
)


@automation.register_action(
    "http_request_head.request",
    HttpRequestSendAction,
    HTTP_REQUEST_HEAD_ACTION_SCHEMA,
    synchronous=True,
)
async def http_request_head_action_to_code(config, action_id, template_arg, args):
    return await http_request_action_to_code(config, action_id, template_arg, args)
