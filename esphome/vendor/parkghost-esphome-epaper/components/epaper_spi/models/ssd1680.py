"""SSD1680 monochrome e-paper controller.

Panels:
- GDEM029T94 (Good Display): 128x296 monochrome

Full refresh uses the controller's built-in OTP waveform; only the partial
waveform LUT is host-supplied (panel data). BUSY is active-HIGH (the default).
"""

import esphome.codegen as cg
from esphome.core import ID

from ..display import CONF_INIT_SEQUENCE_ID
from . import RequiredPinsModel


class SSD1680(RequiredPinsModel):
    def __init__(self, name, lut_partial, **defaults):
        super().__init__(name, "EPaperSSD1680", **defaults)
        self.lut_partial = lut_partial

    def get_constructor_args(self, config) -> tuple:
        base = config[CONF_INIT_SEQUENCE_ID].id
        lut_partial = cg.static_const_array(
            ID(base + "_lut_partial", type=cg.uint8), self.lut_partial
        )
        return (lut_partial, len(self.lut_partial))

    def get_init_sequence(self, config):
        _, height = self.get_dimensions(config)
        # SWRESET (0x12) is issued in reset(); the FSM waits for idle before this.
        return (
            (
                0x01,
                (height - 1) & 0xFF,
                (height - 1) >> 8,
                0x00,
            ),  # driver output control
            (0x3C, 0x05),  # border waveform
            (0x21, 0x00, 0x80),  # display update control
            (0x18, 0x80),  # built-in temperature sensor
        )


# GDEM029T94 partial waveform LUT (based on GxEPD2 GxEPD2_290_T94_V2), 153 bytes.
# fmt: off
_GDEM029T94_LUT_PART = [
    0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
    0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x40,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x00, 0x00, 0x00,
]
# fmt: on

SSD1680(
    "GDEM029T94",
    lut_partial=_GDEM029T94_LUT_PART,
    width=128,
    height=296,
    data_rate="4MHz",
    minimum_update_interval="1s",
)


class SSD1680BWR(RequiredPinsModel):
    """SSD1680 3-color; the non-full path is a fast whole-screen redraw (like
    SSD1683 BWR), using the OTP waveform — no host LUT."""

    def __init__(self, name, **defaults):
        super().__init__(name, "EPaperSSD1680BWR", **defaults)

    def get_init_sequence(self, config):
        _, height = self.get_dimensions(config)
        # SWRESET (0x12) is issued in reset(); the RAM window is set by the driver.
        return (
            (
                0x01,
                (height - 1) & 0xFF,
                (height - 1) >> 8,
                0x00,
            ),  # driver output control
            (0x3C, 0x05),  # border waveform
            (0x18, 0x80),  # built-in temperature sensor
        )


SSD1680BWR(
    "GDEY029Z95", width=128, height=296, data_rate="4MHz", minimum_update_interval="20s"
)
