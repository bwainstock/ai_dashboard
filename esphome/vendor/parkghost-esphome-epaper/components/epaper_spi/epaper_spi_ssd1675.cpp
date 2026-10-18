#include "epaper_spi_ssd1675.h"

#include <algorithm>

namespace esphome::epaper_spi {

void EPaperSSD1675::set_ram_area_() {
  this->cmd_data(0x11, {0x03});  // data entry mode: x+ y+
  this->cmd_data(0x44, {0x00, (uint8_t) ((this->width_ - 1) / 8)});
  this->cmd_data(0x45, {0x00, 0x00, (uint8_t) ((this->height_ - 1) % 256), (uint8_t) ((this->height_ - 1) / 256)});
  this->cmd_data(0x4E, {0x00});
  this->cmd_data(0x4F, {0x00, 0x00});
}

void EPaperSSD1675::send_update_(uint8_t mode) {
  this->cmd_data(0x22, {mode});
  this->command(0x20);
}

bool EPaperSSD1675::initialise(bool partial) {
  if (!EPaperBase::initialise(partial)) {  // declarative init (0x74/0x7E/0x01/0x3C/0x2C/0x03/0x04/0x3A/0x3B)
    return false;
  }
  if (partial) {
    this->cmd_data(0x2C, {0x26});  // VCOM adjust for the partial waveform
  }
  // Load the waveform LUT (panel-specific), then enable the clock + analog.
  if (partial && this->lut_partial_length_ > 0) {
    this->cmd_data(0x32, this->lut_partial_, this->lut_partial_length_);
  } else {
    this->cmd_data(0x32, this->lut_full_, this->lut_full_length_);
  }
  this->send_update_(0xC0);
  return true;
}

bool HOT EPaperSSD1675::transfer_data() {
  const uint32_t start_time = millis();
  const size_t frame = this->buffer_length_;
  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  if (this->current_data_index_ == 0) {
    this->set_ram_area_();
    this->command(0x24);  // write B/W RAM
  }
  this->start_data_();
  while (this->current_data_index_ < frame) {
    const size_t n = std::min(MAX_TRANSFER_SIZE, frame - this->current_data_index_);
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
  this->current_data_index_ = 0;
  return true;
}

void EPaperSSD1675::refresh_screen(bool partial) {
  this->send_update_(partial ? 0x04 : 0xC4);  // display update mode
}

void EPaperSSD1675::power_off() {
  // Copy the just-displayed frame into the OLD RAM bank (0x26) so the next
  // differential partial update has a valid reference. Only needed when partial
  // updates are enabled. The panel is small (~2.7 KB), so this one-shot write
  // stays well under a loop tick.
  if (this->is_using_partial_update_()) {
    this->set_ram_area_();
    this->command(0x26);
    this->start_data_();
    uint8_t bytes_to_send[MAX_TRANSFER_SIZE];
    size_t i = 0;
    while (i < this->buffer_length_) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, this->buffer_length_ - i);
      // split_buffer may be non-contiguous: read element-by-element.
      for (size_t k = 0; k < n; k++)
        bytes_to_send[k] = this->buffer_[i + k];
      this->write_array(bytes_to_send, n);
      i += n;
    }
    this->disable();
  }

  this->send_update_(0xC3);  // power off
}

void EPaperSSD1675::deep_sleep() {
  this->cmd_data(0x10, {0x01});  // enter deep sleep
}

}  // namespace esphome::epaper_spi
