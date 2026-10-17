#include "epaper_spi_uc8176_bwr.h"

#include <algorithm>

namespace esphome::epaper_spi {

static bool is_red(Color color) {
  return (color.red > 0 && color.green == 0 && color.blue == 0) ||     // red
         (color.red == 255 && color.green == 255 && color.blue == 0);  // yellow -> red
}

void EPaperUC8176BWR::draw_pixel_at(int x, int y, Color color) {
  if (!this->rotate_coordinates_(x, y))
    return;

  const uint32_t pos = (x / 8) + (y * this->row_width_);
  const uint8_t bit = 0x80 >> (x & 0x07);
  const uint32_t red_offset = this->buffer_length_ / 2u;

  // Black/White plane (matches the legacy waveshare_epaper BWR convention).
  if (color.is_on()) {
    this->buffer_[pos] |= bit;
  } else {
    this->buffer_[pos] &= ~bit;
  }

  // Red plane
  if (is_red(color)) {
    this->buffer_[red_offset + pos] |= bit;
  } else {
    this->buffer_[red_offset + pos] &= ~bit;
  }
}

void EPaperUC8176BWR::fill(Color color) {
  if (this->get_clipping().is_set()) {
    Display::fill(color);
    return;
  }
  const size_t half_buffer = this->buffer_length_ / 2u;
  const uint8_t bw = color.is_on() ? 0xFF : 0x00;
  const uint8_t red = is_red(color) ? 0xFF : 0x00;
  for (size_t i = 0; i < half_buffer; i++)
    this->buffer_[i] = bw;
  for (size_t i = 0; i < half_buffer; i++)
    this->buffer_[half_buffer + i] = red;

  this->x_low_ = 0;
  this->y_low_ = 0;
  this->x_high_ = this->width_;
  this->y_high_ = this->height_;
}

bool HOT EPaperUC8176BWR::transfer_data() {
  const uint32_t start_time = millis();
  const size_t half_buffer = this->buffer_length_ / 2u;
  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  // Phase 1: Black/White plane -> RAM 0x10 (as-is)
  if (this->current_data_index_ < half_buffer) {
    if (this->current_data_index_ == 0) {
      this->command(0x10);
    }
    this->start_data_();
    while (this->current_data_index_ < half_buffer) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, half_buffer - this->current_data_index_);
      // split_buffer may be non-contiguous: read element-by-element.
      for (size_t k = 0; k < n; k++)
        bytes_to_send[k] = this->buffer_[this->current_data_index_ + k];
      this->write_array(bytes_to_send, n);
      this->current_data_index_ += n;
      if (millis() - start_time > MAX_TRANSFER_TIME) {
        this->disable();
        return false;
      }
    }
    this->disable();
  }

  // Phase 2: Red plane -> RAM 0x13 (inverted)
  if (this->current_data_index_ < this->buffer_length_) {
    if (this->current_data_index_ == half_buffer) {
      this->command(0x13);
    }
    this->start_data_();
    while (this->current_data_index_ < this->buffer_length_) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, this->buffer_length_ - this->current_data_index_);
      for (size_t i = 0; i < n; i++) {
        bytes_to_send[i] = ~this->buffer_[this->current_data_index_ + i];
      }
      this->write_array(bytes_to_send, n);
      this->current_data_index_ += n;
      if (millis() - start_time > MAX_TRANSFER_TIME) {
        this->disable();
        return false;
      }
    }
    this->disable();
  }

  this->current_data_index_ = 0;
  return true;
}

}  // namespace esphome::epaper_spi
