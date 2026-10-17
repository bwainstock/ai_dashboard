"""SSD1608 (IL3820) monochrome e-paper controller.

Panels:
- GDEH029A1 (Good Display): 128x296 monochrome

The waveform LUTs are a property of the panel, so each registration passes its
own full/partial tables to the generic SSD1608 driver.

BUSY is active-HIGH (the component default, no inversion).
"""

from . import LutModel


class SSD1608(LutModel):
    def __init__(self, name, lut_full, lut_partial=None, **defaults):
        super().__init__(name, "EPaperSSD1608", lut_full, lut_partial, **defaults)

    def get_init_sequence(self, config):
        _, height = self.get_dimensions(config)
        return (
            (
                0x01,
                (height - 1) & 0xFF,
                (height - 1) >> 8,
                0x00,
            ),  # driver output control
            (0x0C, 0xD7, 0xD6, 0x9D),  # booster soft start
            (0x2C, 0xA8),  # VCOM setting
            (0x3A, 0x1A),  # dummy line
            (0x3B, 0x08),  # gate time
        )


# GDEH029A1 waveform LUTs (based on GxEPD2 GxEPD2_290).
# fmt: off
_GDEH029A1_LUT_FULL = [
    0x50, 0xAA, 0x55, 0xAA, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xFF, 0x1F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]
_GDEH029A1_LUT_PART = [
    0x10, 0x18, 0x18, 0x08, 0x18, 0x18, 0x08, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x13, 0x14, 0x44, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]
# fmt: on

SSD1608(
    "GDEH029A1",
    lut_full=_GDEH029A1_LUT_FULL,
    lut_partial=_GDEH029A1_LUT_PART,
    width=128,
    height=296,
    data_rate="4MHz",
    minimum_update_interval="1s",
)
