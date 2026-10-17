#include "epaper_spi_ssd1608.h"

#include <algorithm>

namespace esphome::epaper_spi {

void EPaperSSD1608::set_ram_area_() {
  this->cmd_data(0x11, {0x03});  // data entry mode: x+ y+
  this->cmd_data(0x44, {0x00, (uint8_t) ((this->width_ - 1) / 8)});
  this->cmd_data(0x45, {0x00, 0x00, (uint8_t) ((this->height_ - 1) % 256), (uint8_t) ((this->height_ - 1) / 256)});
  this->cmd_data(0x4E, {0x00});
  this->cmd_data(0x4F, {0x00, 0x00});
}

void EPaperSSD1608::send_update_(uint8_t mode) {
  this->cmd_data(0x22, {mode});
  this->command(0x20);
}

bool EPaperSSD1608::initialise(bool partial) {
  if (!EPaperBase::initialise(partial)) {  // declarative init (0x01, 0x0C, 0x2C, 0x3A, 0x3B)
    return false;
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

bool HOT EPaperSSD1608::transfer_data() {
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
    // split_buffer may be non-contiguous: read element-by-element, not &buffer_[i].
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

void EPaperSSD1608::refresh_screen(bool partial) {
  this->send_update_(partial ? 0x04 : 0xC4);  // display update mode
}

void EPaperSSD1608::power_off() { this->send_update_(0xC3); }

void EPaperSSD1608::deep_sleep() {
  // The FSM hardware-resets before every update, so RAM is not retained anyway;
  // the partial LUT does not depend on an OLD bank (matches the legacy driver).
  this->cmd_data(0x10, {0x01});  // enter deep sleep
}

}  // namespace esphome::epaper_spi
