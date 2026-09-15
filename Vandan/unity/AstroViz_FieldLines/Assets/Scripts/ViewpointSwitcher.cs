using UnityEngine;
using UnityEngine.Video;
using UnityEngine.InputSystem;

public class ViewpointSwitcher : MonoBehaviour
{
    public VideoPlayer videoPlayer;
    public VideoClip[] planetClips = new VideoClip[4];

    [Header("Real/simulated joystick input")]
    public InputActionReference joystickAction;
    public float stickThreshold = 0.5f;

    private int currentIndex = 0;
    private bool stickArmed = true;

    void OnEnable()
    {
        if (joystickAction != null)
            joystickAction.action.Enable();
    }

    void OnDisable()
    {
        if (joystickAction != null)
            joystickAction.action.Disable();
    }

    void Start()
    {
        videoPlayer.clip = planetClips[currentIndex];
        videoPlayer.Play();
    }

    void Update()
    {
        // Keyboard still works too - handy for quick desktop testing.
        if (Input.GetKeyDown(KeyCode.RightArrow))
        {
            currentIndex = (currentIndex + 1) % planetClips.Length;
            SwitchClip();
        }
        else if (Input.GetKeyDown(KeyCode.LeftArrow))
        {
            currentIndex = (currentIndex - 1 + planetClips.Length) % planetClips.Length;
            SwitchClip();
        }

        // Real or simulated thumbstick.
        if (joystickAction != null)
        {
            Vector2 stick = joystickAction.action.ReadValue<Vector2>();

            if (stickArmed && stick.x > stickThreshold)
            {
                currentIndex = (currentIndex + 1) % planetClips.Length;
                SwitchClip();
                stickArmed = false;
            }
            else if (stickArmed && stick.x < -stickThreshold)
            {
                currentIndex = (currentIndex - 1 + planetClips.Length) % planetClips.Length;
                SwitchClip();
                stickArmed = false;
            }
            else if (Mathf.Abs(stick.x) < 0.2f)
            {
                stickArmed = true; // stick has returned near center - ready to trigger again
            }
        }
    }

    void SwitchClip()
    {
        videoPlayer.Stop();
        videoPlayer.clip = planetClips[currentIndex];
        videoPlayer.Play();
    }
}