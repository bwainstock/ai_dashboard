#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * UC8176 (IL0398) 3-color (black/white/red) e-paper controller
 * (e.g. Good Display GDEW042Z15, 400x300). Full refresh only.
 *
 * Buffer layout: two 1-bpp planes.
 * - first half:  Black/White plane (bit = color.is_on()) -> RAM 0x10 (as-is)
 * - second half: Red plane         (bit 1 = red)         -> RAM 0x13 (inverted)
 */
class EPaperUC8176BWR : public EPaperBase {
 public:
  EPaperUC8176BWR(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
                  size_t init_sequence_length)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, DISPLAY_TYPE_COLOR) {
    this->buffer_length_ = this->row_width_ * height * 2;  // two 1-bpp planes
    this->busy_invert_ = true;                             // UC8176 BUSY is active-LOW
  }

  void fill(Color color) override;
  void clear() override { this->fill(COLOR_ON); }  // white paper

 protected:
  void draw_pixel_at(int x, int y, Color color) override;
  bool transfer_data() override;
  void power_on() override { this->command(0x04); }                        // POWER ON
  void refresh_screen(bool /*partial*/) override { this->command(0x12); }  // DISPLAY REFRESH
  void power_off() override {
    this->cmd_data(0x50, {0xF7});  // VCOM/interval, border floating
    this->command(0x02);           // POWER OFF
  }
  void deep_sleep() override { this->cmd_data(0x07, {0xA5}); }  // DEEP SLEEP
};

}  // namespace esphome::epaper_spi
