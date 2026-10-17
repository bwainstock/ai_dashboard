from typing import Any, Self

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import (
    CONF_BUSY_PIN,
    CONF_DIMENSIONS,
    CONF_HEIGHT,
    CONF_RESET_PIN,
    CONF_WIDTH,
)
from esphome.core import ID


class EpaperModel:
    models: dict[str, Self] = {}

    def __init__(
        self,
        name: str,
        class_name: str,
        initsequence=None,
        **defaults,
    ):
        name = name.upper()
        self.name = name
        self.class_name = class_name
        self.initsequence = initsequence
        self.defaults = defaults
        EpaperModel.models[name] = self

    def get_default(self, key, fallback: Any = False) -> Any:
        return self.defaults.get(key, fallback)

    def get_init_sequence(self, config: dict):
        return self.initsequence

    def option(self, name, fallback=cv.UNDEFINED) -> cv.Optional | cv.Required:
        if fallback is None and self.get_default(name, None) is None:
            return cv.Required(name)
        return cv.Optional(name, default=self.get_default(name, fallback))

    def get_constructor_args(self, config) -> tuple:
        return ()

    def get_dimensions(self, config) -> tuple[int, int]:
        if CONF_DIMENSIONS in config:
            # Explicit dimensions, just use as is
            dimensions = config[CONF_DIMENSIONS]
            if isinstance(dimensions, dict):
                width = dimensions[CONF_WIDTH]
                height = dimensions[CONF_HEIGHT]
            else:
                (width, height) = dimensions

        else:
            # Default dimensions, use model defaults
            width = self.get_default(CONF_WIDTH)
            height = self.get_default(CONF_HEIGHT)
        return width, height

    def extend(self, name, **kwargs) -> "EpaperModel":
        """
        Extend the current model with additional parameters or a modified init sequence.
        Parameters supplied here will override the defaults of the current model.
        if the initsequence is not provided, the current model's initsequence will be used.
        If add_init_sequence is provided, it will be appended to the current initsequence.
        :param name:
        :param kwargs:
        :return:
        """
        initsequence = list(kwargs.pop("initsequence", self.initsequence) or ())
        initsequence.extend(kwargs.pop("add_init_sequence", ()))
        defaults = self.defaults.copy()
        defaults.update(kwargs)
        return self.__class__(name, initsequence=tuple(initsequence), **defaults)


class RequiredPinsModel(EpaperModel):
    """Model whose C++ driver requires the reset and busy pins to be present."""

    def option(self, name, fallback=cv.UNDEFINED) -> cv.Optional | cv.Required:
        if name in (CONF_RESET_PIN, CONF_BUSY_PIN):
            return cv.Required(name)
        return super().option(name, fallback)


class LutModel(RequiredPinsModel):
    """Panel whose waveform LUTs are passed as constructor args to a generic
    SSD16xx driver. Subclasses fix the C++ class_name and the init sequence."""

    def __init__(self, name, class_name, lut_full, lut_partial=None, **defaults):
        super().__init__(name, class_name, **defaults)
        self.lut_full = lut_full
        self.lut_partial = lut_partial or []

    def get_constructor_args(self, config) -> tuple:
        # Deferred to avoid a circular import: display.py imports this package
        # before it defines CONF_INIT_SEQUENCE_ID.
        from ..display import CONF_INIT_SEQUENCE_ID

        base = config[CONF_INIT_SEQUENCE_ID].id
        lut_full = cg.static_const_array(
            ID(base + "_lut_full", type=cg.uint8), self.lut_full
        )
        if self.lut_partial:
            lut_partial = cg.static_const_array(
                ID(base + "_lut_partial", type=cg.uint8), self.lut_partial
            )
        else:
            lut_partial = cg.nullptr
        return (lut_full, len(self.lut_full), lut_partial, len(self.lut_partial))
