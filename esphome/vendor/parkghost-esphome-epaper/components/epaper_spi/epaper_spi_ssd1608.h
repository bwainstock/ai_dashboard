#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * SSD1608 (IL3820) monochrome e-paper controller (e.g. Good Display GDEH029A1,
 * 128x296).
 *
 * Buffer: 1 bit per pixel, single plane (bit 1 = white, 0 = black), written to
 * RAM 0x24. The host loads explicit waveform LUTs (0x32); these are a property
 * of the panel, not the controller, so they are supplied by the model (a full
 * table, and an optional partial table for flicker-free updates). A full update
 * is forced every `full_update_every` times to de-ghost.
 *
 * BUSY is active-HIGH, which is this component's default (no inversion).
 */
class EPaperSSD1608 : public EPaperBase {
 public:
  EPaperSSD1608(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
                size_t init_sequence_length, const uint8_t *lut_full, size_t lut_full_length,
                const uint8_t *lut_partial, size_t lut_partial_length)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, DISPLAY_TYPE_BINARY),
        lut_full_(lut_full),
        lut_full_length_(lut_full_length),
        lut_partial_(lut_partial),
        lut_partial_length_(lut_partial_length) {
    this->buffer_length_ = this->row_width_ * height;  // single 1-bpp plane
  }

 protected:
  bool initialise(bool partial) override;
  bool transfer_data() override;
  void power_on() override {}
  void refresh_screen(bool partial) override;
  void power_off() override;
  void deep_sleep() override;

  void set_ram_area_();
  // 0x22 (display update control) with `mode`, then 0x20 (master activation).
  void send_update_(uint8_t mode);

  // Waveform LUTs, supplied by the model (panel-specific).
  const uint8_t *lut_full_;
  size_t lut_full_length_;
  const uint8_t *lut_partial_;
  size_t lut_partial_length_;
};

}  // namespace esphome::epaper_spi
