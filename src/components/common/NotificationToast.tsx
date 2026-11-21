import React, { useState, useEffect } from 'react';
import { pushNotificationService } from '../../services';
import type { PushNotificationPayload } from '../../types';
import './NotificationToast.css';

export interface NotificationToastProps {
  onActionClick?: (payload: PushNotificationPayload) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ onActionClick }) => {
  const [activeNotification, setActiveNotification] = useState<PushNotificationPayload | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Subscribe to pushNotificationService
    const unsubscribe = pushNotificationService.subscribe((payload) => {
      setActiveNotification(payload);
      setIsVisible(true);

      // Auto-dismiss after 7 seconds if not interacted
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 7000);

      return () => clearTimeout(timer);
    });

    return unsubscribe;
  }, []);

  if (!activeNotification || !isVisible) {
    return null;
  }

  const handleDismiss = () => {
    setIsVisible(false);
  };

  const handleAction = () => {
    if (onActionClick) {
      onActionClick(activeNotification);
    } else if (activeNotification.clickAction) {
      window.location.href = activeNotification.clickAction;
    }
    setIsVisible(false);
  };

  return (
    <div className="okada-notification-toast" role="alert" aria-live="assertive">
      <div className="okada-toast-icon-wrapper">
        <span className="okada-toast-icon">🔔</span>
        <span className="okada-toast-pulse"></span>
      </div>

      <div className="okada-toast-content">
        <div className="okada-toast-header">
          <strong className="okada-toast-title">{activeNotification.title}</strong>
          {activeNotification.orderReference && (
            <span className="okada-toast-badge">{activeNotification.orderReference}</span>
          )}
        </div>
        <p className="okada-toast-body">{activeNotification.body}</p>
      </div>

      <div className="okada-toast-actions">
        {activeNotification.clickAction && (
          <button
            type="button"
            className="okada-toast-btn-action"
            onClick={handleAction}
          >
            View
          </button>
        )}
        <button
          type="button"
          className="okada-toast-btn-close"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
